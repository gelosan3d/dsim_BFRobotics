import type { Alliance, AssistConfig, DrivetrainType, GameId, Motif, RobotSpec, StartPose } from '../types';
import * as C from '../config';
/**
 * The start-anchor COUNT is per game, so the spawn chokepoint has to ask the
 * registry for it. This is a genuine import CYCLE (`games/sim` → a game's `sim.ts` →
 * its spawn → here) and it is safe only because nothing is read at module-eval time:
 * `simModuleFor` is a hoisted function declaration and `coerceSetup` calls it at
 * runtime. Do not move a registry read to this file's top level.
 */
import { simModuleFor } from '../games/sim';
/**
 * The BIOBUZZ arm of `coerceSpec`, from a LEAF module. It holds this game's own clamps (the
 * size envelope per intake mount, the archetype mass floor, the hopper ceiling) so that no
 * BIOBUZZ number lives in `src/sim/` — the same split Chain Reaction's arm uses, and the repo
 * rule in `docs/biobuzz-contract.md`. It must stay a leaf: it is a DEPENDENCY of this file, so
 * an import there that reached back here would be a cycle around the shared chokepoint.
 */
import { coerceBiobuzzSpec } from '../games/biobuzz/coerce';
import {
  CHAIN_CLEARANCE_DEFAULT,
  CHAIN_CLEARANCE_MAX,
  CHAIN_CLEARANCE_MIN,
  CHAIN_STORAGE_DEFAULT,
  CHAIN_STORAGE_MIN,
  chainStorageMax,
  chainMassFloorBump,
  CHAIN_CATALYST_TYPES,
  CHAIN_DEFAULT_CATALYST,
  CHAIN_DEFAULT_CATALYST_MOUNT,
  CHAIN_CATAPULT_RANGE_MIN,
  CHAIN_CATAPULT_RANGE_MAX,
  CHAIN_CATAPULT_RANGE_DEFAULT,
  CHAIN_CATAPULT_YAW_DEFAULT,
  CHAIN_CATAPULT_YAW_STEP,
  CHAIN_DEFAULT_SCORE_MODE,
  CHAIN_DEFAULT_INTAKE,
  CHAIN_SCORE_MODES,
  CHAIN_INTAKE_STYLES,
  chainSizeLimits,
  chainMountFits,
} from '../games/chain/config';
import {
  CHAIN_CATALYST_MOUNTS,
  CHAIN_RAIL_MOUNTS,
  intakeMountOf,
  SWING_MOUNTS,
  isEdgePos,
  isSwingMount,
  isTurreted,
  mountsClash,
  railEdgeOf,
  shooterEdgeOf,
  shooterMountOf,
} from '../games/chain/mounts';
import { clamp } from '../math';
import { COSMETIC_AXES, clampCosmetics, type Cosmetics } from '../cosmetics';
import { butterflyTankRpmLimits, lengthLimits, massLimits, rpmLimits, widthLimits } from './drivetrain';

/**
 * DECODE's three motifs (obelisk AprilTags 21–23). DECODE is gone from this fork (2026-10-12),
 * but `World.motif` is not: Chain Reaction and BIOBUZZ fill it with `MOTIFS[0]`, inert, because
 * `worldHash`, the snapshot diff and BFSIM's own servers all read the field. Kept for that.
 */
export const MOTIFS: Motif[] = [
  ['green', 'purple', 'purple'], // obelisk AprilTag 21: GPP
  ['purple', 'green', 'purple'], // 22: PGP
  ['purple', 'purple', 'green'], // 23: PPG
];

/**
 * The DEFAULT spec now LIVES IN A LEAF (`./specDefaults`) and is re-exported here, so every
 * existing importer is unchanged. It had to move: a game module reads it at MODULE-EVAL time
 * (BIOBUZZ's `BB_DEFAULT_SPEC` is a top-level spread of it), and this file is inside the
 * registry import cycle, so the read landed in `DEFAULT_SPEC`'s TDZ and threw at import.
 * `specDefaults.ts`'s header has the whole story. Do not move it back.
 */
import { DEFAULT_SPEC } from './specDefaults';
export { DEFAULT_SPEC };

// Neutral sim/wire FALLBACK for assists (used by coercion bases, replay, server
// fill-robots, dummies, and smoke). Deliberately NOT the same as the player's
// menu default (`defaultAssistsFor` below): tests + fallbacks want auto OFF.
export const DEFAULT_ASSISTS: AssistConfig = {
  fieldCentric: true,
  aimAssist: true,
  autoIntake: false,
  autoFire: false,
};

/**
 * The player-facing DEFAULT assists, and the default for `RobotSpec.assists` — EVERY assist
 * is ON, including field-centric drive, for every drivetrain and BOTH games.
 *
 * Assists used to be remembered per DRIVETRAIN (with swerve alone defaulting field-centric);
 * they are now saved ON THE ROBOT (`RobotSpec.assists`), so the memory is per-build and the
 * per-drivetrain library is gone. Distinct from `DEFAULT_ASSISTS` above, which stays auto-OFF
 * as the neutral sim/wire fallback for replay, dummies, and smoke.
 */
export const PLAYER_ASSISTS: AssistConfig = {
  fieldCentric: true,
  aimAssist: true,
  autoIntake: true,
  autoFire: true,
};

/** the player default (kept as a function for call sites; no longer drivetrain-dependent) */
export function defaultAssistsFor(_d?: DrivetrainType): AssistConfig {
  return { ...PLAYER_ASSISTS };
}

// ---- untrusted-input sanitization -------------------------------------------
// A player's robot config arrives from localStorage (hand-editable) AND, in
// multiplayer, straight off the wire from an untrusted client (people have
// spoofed it via devtools to spawn oversized / NaN-dimensioned robots). These
// coercers are the SINGLE SOURCE OF TRUTH for "what is a legal config": every
// numeric field is forced finite and clamped to its per-drivetrain / per-preset
// range, every enum is checked, and anything missing falls back to a default.
// They are IDEMPOTENT, so it is safe to run them at multiple layers (client
// settings load, server ingress, AND createWorld) — belt and suspenders.

/** clamp `n` to [lo,hi], substituting `fallback` when it is not a finite number
 * (guards against NaN/Infinity: bare `clamp(NaN,...)` returns NaN unchanged) */
function clampFinite(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : clamp(fallback, lo, hi);
}

/** Coerce an arbitrary value into a fully-legal RobotSpec. Unknown/missing/
 * corrupt fields fall back to `base` (default: DEFAULT_SPEC); all numeric fields
 * are clamped to their legal ranges (length per intake preset, mass per
 * drivetrain×inertia, rpm per drivetrain). Never throws; always returns a spec
 * safe to spawn. */
export function coerceSpec(raw: unknown, base: RobotSpec = DEFAULT_SPEC, game?: GameId): RobotSpec {
  const out: RobotSpec = { ...base };
  const sp = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  // The clamp order is DELIBERATE — it mirrors the builder UI's dependency graph
  // exactly, so a hand-edited / spoofed / stale spec is bounded the same way the
  // sliders bound a live one. Each numeric range is resolved from ONLY the
  // field(s) it depends on, in this order:
  //   1. INTAKE + DRIVETRAIN → length range (intake) + width range (drivetrain floor)
  //   2. DRIVETRAIN         → rpm range                     (rpmLimits)
  //   3. INERTIA            → 0..1
  //   4. DRIVETRAIN×INERTIA → mass range                   (massLimits: floor ↑ inertia)

  // resolve INTAKE + DRIVETRAIN first (width's floor depends on the drivetrain —
  // swerve needs a wider base). Legacy preset names from older saves migrate.
  if (sp.intake === 'sloped' || sp.intake === 'vector' || sp.intake === 'triangle') out.intake = sp.intake;
  else if (sp.intake === 'compact') out.intake = 'sloped';
  else if (sp.intake === 'extended') out.intake = 'vector';
  if (
    sp.drivetrain === 'mecanum' ||
    sp.drivetrain === 'tank' ||
    sp.drivetrain === 'swerve' ||
    sp.drivetrain === 'xdrive' ||
    sp.drivetrain === 'butterfly'
  ) {
    out.drivetrain = sp.drivetrain;
  }

  // 1) SIZE: length from the intake preset, width floored per drivetrain (DECODE).
  // CR sizes are bounded per BUILD: the sweeper is structure inside the 18" start cube, and
  // its MOUNT decides which axis it eats (ends → length, flanks → width). Resolve the mount
  // first — it is normalised further down, but the size clamp needs it now.
  let preMount = intakeMountOf(
    (sp.intakeMount !== undefined || sp.intakeSide !== undefined ? sp : base) as RobotSpec,
  );
  // a mount whose intake cannot fit the start cube is not a legal build — fall back to the
  // single front sweeper rather than clamping to an oversized chassis
  if (game === 'chain' && !chainMountFits({ ...out, intakeMount: preMount }, preMount)) preMount = 'front';
  const crSize = chainSizeLimits({ ...out, intakeMount: preMount });
  const len =
    game === 'chain'
      ? { min: crSize.minLength, max: crSize.maxLength }
      : lengthLimits(out.intake);
  const wid =
    game === 'chain'
      ? { min: crSize.minWidth, max: crSize.maxWidth }
      : widthLimits(out.intake, out.drivetrain);
  out.length = clampFinite(sp.length, len.min, len.max, base.length);
  out.width = clampFinite(sp.width, wid.min, wid.max, base.width);

  // 2) DRIVETRAIN → rpm range. BUTTERFLY has TWO geared wheel sets, so it has two
  // sliders: `driveRpm` is its mecanum set (the shared field) and `tankRpm` its traction
  // set, clamped to the torque-biased tank envelope. `tankRpm` is written for butterfly
  // only and STRIPPED otherwise, so a spec that switches away can't smuggle a stale value
  // back if it switches return — the same normalize-at-the-chokepoint rule the CR mounts use.
  const rpm = rpmLimits(out.drivetrain);
  out.driveRpm = clampFinite(sp.driveRpm, rpm.min, rpm.max, base.driveRpm);
  if (out.drivetrain === 'butterfly') {
    const tl = butterflyTankRpmLimits();
    const rawTank = sp.tankRpm !== undefined ? sp.tankRpm : base.tankRpm;
    out.tankRpm = clampFinite(rawTank, tl.min, tl.max, clamp(out.driveRpm, tl.min, tl.max));
  } else {
    delete out.tankRpm;
  }

  // 3) INERTIA in 0..1
  out.flywheelInertia = clampFinite(sp.flywheelInertia, 0, 1, base.flywheelInertia);

  // 4) MASS range from DRIVETRAIN × INERTIA (the floor rises with inertia), PLUS any
  // heavy game mechanism. The CR scoring archetype is resolved just below for storage,
  // so read it here from the raw/base input the same way — a twin turret carries a whole
  // second flywheel assembly and cannot be built at the lightest weights.
  const preMode = (CHAIN_SCORE_MODES as readonly string[]).includes(sp.scoreMode as string)
    ? (sp.scoreMode as RobotSpec['scoreMode'])
    : (base.scoreMode ?? CHAIN_DEFAULT_SCORE_MODE);
  const preCatalyst = (CHAIN_CATALYST_TYPES as readonly string[]).includes(sp.catalystType as string)
    ? (sp.catalystType as RobotSpec['catalystType'])
    : (base.catalystType ?? CHAIN_DEFAULT_CATALYST);
  // the catapult's RANGE feeds its weight, so it has to be resolved before the mass clamp
  // (it is written to `out` further down, in the catalyst block)
  const preRange = clampFinite(
    sp.catapultRange !== undefined ? sp.catapultRange : base.catapultRange,
    CHAIN_CATAPULT_RANGE_MIN,
    CHAIN_CATAPULT_RANGE_MAX,
    CHAIN_CATAPULT_RANGE_DEFAULT,
  );
  const mass = massLimits(
    out.drivetrain,
    out.flywheelInertia,
    game === 'chain'
      ? chainMassFloorBump({ ...out, scoreMode: preMode, catalystType: preCatalyst, catapultRange: preRange })
      : 0,
  );
  out.massLb = clampFinite(sp.massLb, mass.min, mass.max, base.massLb);

  // Chain Reaction scoring archetype + intake design (enum checks, defaulted). Resolved
  // BEFORE ball storage: the storage MAX depends on the archetype (+ the size above).
  out.scoreMode = (CHAIN_SCORE_MODES as readonly string[]).includes(sp.scoreMode as string)
    ? (sp.scoreMode as RobotSpec['scoreMode'])
    : (base.scoreMode ?? CHAIN_DEFAULT_SCORE_MODE);
  out.chainIntake = (CHAIN_INTAKE_STYLES as readonly string[]).includes(sp.chainIntake as string)
    ? (sp.chainIntake as RobotSpec['chainIntake'])
    : (base.chainIntake ?? CHAIN_DEFAULT_INTAKE);
  // COSMETICS: chassisColor/accent/decal/plate — four closed axes, `src/cosmetics.ts`. SHAPE
  // ONLY, never entitlement (plan §3.3, docs/cosmetics-plan.md): this coercer also runs over
  // REPLAY RE-SIMULATION, which must always reproduce the look a run was recorded with,
  // whoever is watching it today or what their supporter/earned status is now — baking a tier
  // check in here would silently downgrade an old replay's cosmetics the first time a
  // membership lapses or a key gets re-tiered. Entitlement is enforced only at the server's
  // live ingress (`server/room.ts`, `stripUnentitledCosmetics`), strictly after this clamp.
  // Per axis: an allowlisted raw value wins; otherwise fall back to `base`'s own value for
  // that axis IF IT IS ITSELF a legal key (never propagate an invalid/spoofed base forward);
  // `clampCosmetics` then folds whatever survives onto its closed set, defaulting anything
  // still unrecognised — the same "unknown falls back to base, else default" rule the old
  // single-axis chassisColor clamp used, now shared by all four. Idempotent: re-running this
  // on its own output changes nothing, since every surviving value is already a legal key.
  const cosmeticIn: Cosmetics = {};
  for (const axis of Object.keys(COSMETIC_AXES) as (keyof Cosmetics)[]) {
    const v = sp[axis];
    const bv = base[axis];
    cosmeticIn[axis] =
      typeof v === 'string' && COSMETIC_AXES[axis].includes(v)
        ? v
        : typeof bv === 'string' && COSMETIC_AXES[axis].includes(bv)
          ? bv
          : undefined;
  }
  const cosmetics = clampCosmetics(cosmeticIn);
  out.chassisColor = cosmetics.chassisColor;
  out.accent = cosmetics.accent;
  out.decal = cosmetics.decal;
  out.plate = cosmetics.plate;
  // MECHANISM MOUNTS. Enum-checked, with the legacy `intakeSide`/`shooterRear` booleans as the
  // fallback so old saves + older peers migrate (see games/chain/mounts.ts). `intakeMountOf`/
  // `shooterMountOf` do exactly that resolution, so run them on the RAW input first, then fall
  // back to the base spec's resolved mount when the raw value carried nothing at all.
  const rawMounts = sp as Pick<RobotSpec, 'intakeMount' | 'intakeSide' | 'shooterMount' | 'shooterRear'>;
  const hasIntakeMount = sp.intakeMount !== undefined || sp.intakeSide !== undefined;
  const hasShooterMount = sp.shooterMount !== undefined || sp.shooterRear !== undefined;
  // CATALYST mechanism: type + mount, enum-checked like the others. Resolved BEFORE the
  // mass clamp above reads it? No — mass is clamped earlier, so the floor uses the RAW
  // type via `preMode`'s sibling below; keep both in sync if a new heavy mechanism lands.
  out.catalystType = (CHAIN_CATALYST_TYPES as readonly string[]).includes(sp.catalystType as string)
    ? (sp.catalystType as RobotSpec['catalystType'])
    : (base.catalystType ?? CHAIN_DEFAULT_CATALYST);
  // 'frontback' is not in CHAIN_CATALYST_MOUNTS any more (it was the swing, not a place), but
  // it still arrives from old saves and older clients — accept it here and migrate it below.
  out.catalystMount =
    (CHAIN_CATALYST_MOUNTS as readonly string[]).includes(sp.catalystMount as string) ||
    sp.catalystMount === 'frontback'
      ? (sp.catalystMount as RobotSpec['catalystMount'])
      : (base.catalystMount ?? CHAIN_DEFAULT_CATALYST_MOUNT);
  // the axis, accepting BOTH legacy shapes: the boolean this field briefly was (⇒ fore-aft,
  // the only kind that existed then) and the `'frontback'` mount before that
  out.catalystSwing =
    sp.catalystSwing === true || sp.catalystSwing === 'fb'
      ? 'fb'
      : sp.catalystSwing === 'lr'
        ? 'lr'
        : sp.catalystSwing === false
          ? undefined
          : base.catalystSwing;
  // CATAPULT build: range (in) and the fixed mounting yaw (deg, 15° steps). Only meaningful
  // on the launcher, but kept on the spec unconditionally so switching mechanism back and
  // forth doesn't silently discard the build.
  out.catapultRange = Math.round(
    clampFinite(
      sp.catapultRange !== undefined ? sp.catapultRange : base.catapultRange,
      CHAIN_CATAPULT_RANGE_MIN,
      CHAIN_CATAPULT_RANGE_MAX,
      CHAIN_CATAPULT_RANGE_DEFAULT,
    ),
  );
  {
    const rawYaw = sp.catapultYaw !== undefined ? sp.catapultYaw : base.catapultYaw;
    const y = clampFinite(rawYaw, -180, 180, CHAIN_CATAPULT_YAW_DEFAULT);
    out.catapultYaw = Math.round(y / CHAIN_CATAPULT_YAW_STEP) * CHAIN_CATAPULT_YAW_STEP;
  }
  out.intakeMount = game === 'chain' ? preMount : hasIntakeMount ? intakeMountOf(rawMounts) : intakeMountOf(base);
  out.shooterMount = hasShooterMount ? shooterMountOf(rawMounts) : shooterMountOf(base);
  // A TURRETLESS launcher fires along a LINE spanning a chassis SIDE, so a corner or centre
  // mount is not something it can be built as — fold it to the nearest edge. A TURRET keeps any
  // of the nine positions: it aims itself, so its mount is where it is BOLTED (and therefore
  // where the Particle is born), not a facing. Resolved HERE, the one chokepoint, so a spec
  // that changes archetype later can never keep a mount that archetype cannot have.
  if (!isTurreted(out.scoreMode)) out.shooterMount = shooterEdgeOf({ shooterMount: out.shooterMount });

  // MIRROR the deprecated booleans so a spec routed through an older peer/server (which drops
  // the fields it doesn't know) round-trips to the nearest legal mount instead of resetting.
  out.intakeSide = out.intakeMount === 'side';
  out.shooterRear = out.shooterMount === 'back';

  /**
   * CATALYST PLACEMENT — resolved HERE, AFTER the per-game mount reset above.
   *
   * It depends on the SHOOTER mount, so it has to run once that is final. Running it any
   * earlier is not just untidy, it breaks IDEMPOTENCY: a DECODE spec has its shooter mount
   * reset to the default further down, so a first pass would place the catalyst against the
   * raw mount and a second pass against the reset one, and coerceSpec runs at several layers.
   *
   * Two rules, both physical:
   *  1. A RAIL's track spans a whole chassis SIDE, so it can only be bolted to one of the
   *     four EDGES. A corner has no span to run along and the frontback swing is a different
   *     mechanism. Folded like the turretless launcher's firing edge is folded.
   *  2. NO TWO MECHANISMS SHARE A CELL. There is one piece of frame in a given spot and only
   *     one thing can be mounted to it, so a catalyst is pushed off any cell the shooter or
   *     the intake already occupies (`occupiedCells` handles the edge-spanning and frontback
   *     cases, which take more than one cell each).
   *
   * Done at the chokepoint rather than in the builder so a spec that changes archetype,
   * mount or intake later can never end up with two mechanisms in the same place — including
   * one arriving from an older client that never knew the rule.
   */
  {
    const railed = out.catalystType === 'rail';
    /**
     * THE SWING, resolved before anything else reads the mount.
     *
     * `'frontback'` was the old way of saying "a centre-pivot swing" — a MOUNT that was
     * really a mechanism, which is why "a swing, on the right" could not be expressed. It is
     * migrated here rather than at the call sites so every reader (sim, renderers, picker,
     * the wire) sees one shape.
     *
     * Then two physical rules: a RAIL is a track, not a pivot, so it never swings; and a
     * pivot needs a front and a back to swing between, so it lives on the centre line or a
     * flank. An illegal pairing drops the SWING rather than moving the mount — the player
     * chose where to bolt it, and silently relocating hardware is the thing this whole block
     * exists to avoid.
     */
    if (out.catalystMount === ('frontback' as RobotSpec['catalystMount'])) {
      out.catalystMount = 'center';
      out.catalystSwing = 'fb';
    }
    // Only the ARM swings (a turret aims itself, a rail traverses), and a pivot only works
    // where BOTH of its ends are reachable — which depends on the axis, so the mechanism and
    // the position are checked together.
    if (
      out.catalystType !== 'arm' ||
      (out.catalystSwing && !isSwingMount(out.catalystMount as string, out.catalystSwing))
    ) {
      out.catalystSwing = undefined;
    }
    // ...and the middle of a chassis reaches nothing without one, so a centre mount that is
    // not a pivot falls to the front edge.
    if (out.catalystMount === 'center' && !out.catalystSwing) out.catalystMount = 'front';
    if (railed && !isEdgePos(out.catalystMount as string)) {
      out.catalystMount = railEdgeOf(out.catalystMount as string);
    }
    // What the SHOOTER is sitting on. A turretless launcher fires along a line spanning its
    // edge, so it takes that whole side; a turret is a single bolted cell.
    //
    // The INTAKE is deliberately NOT a blocker. A sweeper is a low roller at floor level and
    // a claw arm reaches over it — real robots stack those two all the time — whereas the
    // shooter and the catalyst both want the deck. Counting the sweeper would also make two
    // of the shipped preset builds illegal (front+back sweepers plus a front/back swing claw),
    // which is a strong hint the rule is about the deck rather than about the edge.
    const blockers = [{ pos: out.shooterMount as string, spansEdge: !isTurreted(out.scoreMode) }];
    const clashes = (m: string): boolean =>
      blockers.some((b) => mountsClash({ pos: m, spansEdge: railed, swing: out.catalystSwing ?? null }, b));
    if (clashes(out.catalystMount as string)) {
      // The fallback set has to be places THIS mechanism can legally live, or the relocation
      // silently produces a build the next pass has to fix again — which is exactly how this
      // broke idempotency: a swing pushed onto a corner had its swing quietly dropped on the
      // second pass, so coerceSpec(coerceSpec(x)) !== coerceSpec(x).
      const options = railed
        ? (CHAIN_RAIL_MOUNTS as readonly string[])
        : out.catalystSwing
          ? (SWING_MOUNTS[out.catalystSwing] as readonly string[])
          : (CHAIN_CATALYST_MOUNTS as readonly string[]).filter((m) => m !== 'center');
      const free = options.find((m) => !clashes(m));
      // if EVERY position clashes the build is over-stuffed; leave the mount alone rather
      // than inventing one, and let the builder's own warning explain it
      if (free) out.catalystMount = free as RobotSpec['catalystMount'];
    }
  }
  // Chain Reaction ball storage — clamped to the archetype+size max (chainStorageMax). NOTE: the
  // intake-mount storage penalty depends on out.intakeMount, so it's resolved BEFORE this clamp.
  out.ballStorage = Math.round(
    clampFinite(
      sp.ballStorage,
      CHAIN_STORAGE_MIN,
      chainStorageMax(out),
      base.ballStorage ?? CHAIN_STORAGE_DEFAULT,
    ),
  );
  // Chain Reaction ground clearance (inches) — over-a-beam capability vs raised CoG
  out.groundClearance = clampFinite(
    sp.groundClearance,
    CHAIN_CLEARANCE_MIN,
    CHAIN_CLEARANCE_MAX,
    base.groundClearance ?? CHAIN_CLEARANCE_DEFAULT,
  );

  // DRIVER ASSISTS ride the robot (both games), every flag defaulting ON. Each flag is
  // validated independently, so an old spec with no `assists` (or a partial one off the
  // wire) fills from the base rather than being dropped.
  out.assists = coerceAssists(sp.assists, base.assists ?? PLAYER_ASSISTS);

  // identity + flags (no cross-field dependency)
  if (typeof sp.canSort === 'boolean') out.canSort = sp.canSort;
  if (typeof sp.name === 'string' && sp.name.trim()) out.name = sp.name.slice(0, 24);
  if (typeof sp.teamName === 'string') out.teamName = sp.teamName.slice(0, 48);
  out.teamNumber = Math.round(clampFinite(sp.teamNumber, 0, 99999, base.teamNumber));

  /**
   * THE BIOBUZZ ARM, LAST — this game's own clamps, over a spec every shared pass above has
   * already bounded.
   *
   * Last rather than interleaved, because the two halves clamp DIFFERENT things and the second
   * depends on the first: the shared pass fixes the intake preset, the drivetrain, the rpm and
   * the inertia, and BIOBUZZ's size envelope, mass floor and hopper ceiling are all derived
   * from those plus the mounts resolved just above. Interleaving would mean resolving a range
   * from a field that is not final yet, which is exactly what breaks IDEMPOTENCY — and
   * `coerceSpec` running at several layers (settings load, server ingress, `createWorld`) is
   * what makes idempotency load-bearing rather than tidy. The BIOBUZZ smoke suite asserts
   * `f(f(x)) === f(x)` over a hostile input matrix and over all 26 shipped builds.
   *
   * It also STRIPS the Chain Reaction fields a BIOBUZZ robot has no mechanism for (the
   * catalyst, the catapult, the ground clearance), which is why it has to run after the blocks
   * above write them. Moving it ahead of the CR blocks would put those fields BACK on the spec
   * after the strip, so a BIOBUZZ robot would carry a catalyst mount again — the ordering is
   * load-bearing in both directions.
   *
   * ⚠️ WHAT "LAST" DOES NOT MEAN, and the trap for the first `bb*` spec field: this arm is
   * handed `out`, not the RAW input. `out` starts as a copy of `base` and gains only the fields
   * the passes above explicitly read off `sp`, so a value that no shared pass knows about is
   * already gone by the time the game coercer runs — it would silently fall back to the base
   * spec's value on every load, every wire ingress and every `createWorld`, which reads as "the
   * builder keeps forgetting my setting". The fix, when a BIOBUZZ-only field lands, is to carry
   * it across HERE (copy it onto `out`, or hand `coerceBiobuzzSpec` the raw `sp` as a second
   * input) — NOT to move the arm earlier, for the two order reasons above. Chain Reaction has
   * the same shape and does not hit it only because every CR field is read off `sp` by name in
   * this function. `docs/biobuzz-contract.md` §4 is where a new field is registered; add the
   * carry-across in the same change.
   */
  if (game === 'biobuzz') {
    // THE CARRY-ACROSS the ⚠️ block above describes, and `bbMech` is the first field to need
    // it. Nothing in the shared passes reads it by name, so without this line it is already
    // gone by the time the game coercer runs and every mechanism loadout would silently revert
    // to the base spec's on every load, every wire ingress and every `createWorld`.
    //
    // Copied onto `out` UNVALIDATED on purpose: this is a transport step, and
    // `coerceBiobuzzSpec` is the one place allowed to decide what a legal loadout is. It also
    // must NOT default — `undefined` and `{ launcher: null }` mean different things to that
    // function (a legacy spec to migrate vs. a robot with genuinely no launcher).
    out.bbMech = sp.bbMech as RobotSpec['bbMech'];
    // the SAME carry-across for heightIn -- coerceBiobuzzSpec clamps it (BB3_HEIGHT_MIN..MAX)
    // off this field by name, and nothing in the shared passes above reads it, so without this
    // line every real caller (settings load, server ingress, createWorld) silently dropped a
    // spec's heightIn before the biobuzz clamp ever saw it -- see this lane's final report.
    out.heightIn = sp.heightIn as RobotSpec['heightIn'];
    // and the declared stow height (R102), read structurally downstream -- same reason
    out.stowHeightIn = sp.stowHeightIn as RobotSpec['stowHeightIn'];
    // and the PASS TARGET pair (`PassPicker.tsx`) -- same trap, same fix. Without this, every
    // edit from the builder's map/preset picker reverted on the very next coercion (which
    // `setSpec` runs on every keystroke), reading as "the picker does nothing" even though the
    // click handler fires and the patch reaches this function correctly.
    out.bbPassTarget = sp.bbPassTarget as RobotSpec['bbPassTarget'];
    out.bbPassPreset = sp.bbPassPreset as RobotSpec['bbPassPreset'];
    // ⚠️ AND THE MASS, RAW — this one is a carry-across of a SHARED field, for the opposite
    // reason to the four above: the shared pass DID read it, and that is the problem. BIOBUZZ
    // owns its own mass model (`bbMassLimits`: a bare chassis per drivetrain plus every
    // mechanism bolted to it), and `massLimits`' per-drivetrain floor prices in a DECODE
    // shooter, so it sits ABOVE that model for every drivetrain — a mecanum turret build floors
    // at 18.00 in this game and the shared pass had already lifted it to 18 + 4·inertia, a tank
    // one at 19.50 against 22. Step 4 above would therefore raise a legal light build before the
    // game's own clamp could see it, and a preset the coercer moves is a card that can never
    // read as selected. Unvalidated like the fields above: `coerceBiobuzzSpec` re-clamps it
    // (through `clampFinite`, so NaN / Infinity / absent all still fall back to `base`).
    out.massLb = sp.massLb as RobotSpec['massLb'];
    // ...and the SIZE, RAW, for the same reason. Step 1 sized it with DECODE's per-intake
    // `lengthLimits`, whose ceiling (18 − reach, 15 for sloped) is DECODE's in-cube roller rule;
    // a BIOBUZZ sweeper deploys, and `bbSizeLimits` is this game's whole envelope.
    out.length = sp.length as RobotSpec['length'];
    out.width = sp.width as RobotSpec['width'];
    return coerceBiobuzzSpec(out, base);
  }
  return out;
}

/** Coerce an arbitrary value into a legal AssistConfig (each flag defaults to
 * `base` when absent / non-boolean). */
export function coerceAssists(raw: unknown, base: AssistConfig = DEFAULT_ASSISTS): AssistConfig {
  const out: AssistConfig = { ...base };
  if (typeof raw === 'object' && raw !== null) {
    const a = raw as Record<string, unknown>;
    for (const k of ['fieldCentric', 'aimAssist', 'autoIntake', 'autoFire'] as const) {
      if (typeof a[k] === 'boolean') out[k] = a[k];
    }
    // FTC25 shot controls: kept only when ON — a table of exactly FTC25_PRESET_COUNT finite
    // fractions, each clamped to the launcher's range — so a setup without them is byte-identical
    // to one written before the field existed (`AssistConfig.manualShot`). Anything else is off.
    const m = a.manualShot;
    if (Array.isArray(m) && m.length === C.FTC25_SHOT_POWERS.length && m.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      out.manualShot = m.map((v: number) => Math.min(1, Math.max(C.FTC25_MIN_POWER, v)));
    } else delete out.manualShot;
  }
  // AIM ASSIST IS ALWAYS ON, in BOTH games — the menu toggle is gone, and this is what
  // makes that true rather than merely unreachable. It has to be HERE, because a stored
  // `false` can arrive from four directions: localStorage, a synced account blob, a saved
  // robot slot (`coerceSpec` routes through this), and the wire. Forcing it only in the UI
  // would leave anyone who had switched it off before the removal stuck on manual aim with
  // no control to switch it back.
  //
  // The SIM still branches on `r.aimAssist` (the manual-aim turret path in robot.ts, and
  // Chain's `chainAimAssist`), so the behaviour is intact and tested — tests set the flag
  // on the spawned robot directly. Restoring the option is deleting this line and putting
  // the toggle back in Menu.tsx.
  out.aimAssist = true;
  return out;
}

/** Coerce a whole RobotSetup from untrusted input into a spawn-safe one: legal
 * spec/assists, valid alliance, in-range startIndex, sanitized auto path. The
 * `id` is preserved (it keys the command map). This is the LAST line of defense —
 * `createWorld` runs it on every setup, so no spawn path can produce a bad robot
 * regardless of how the setup was assembled. */
/** structural + bounds coercion for a custom start pose (canonical goalSide=+1
 * frame). Returns null for anything non-finite. Field-clamps x/y and normalizes
 * the heading to [0,360). G304 LEGALITY (over a launch line, touching a surface,
 * own half) is NOT enforced here — that needs the alliance+spec and is applied by
 * `coerceSetup` via `snapStartToLegal`, the spawn chokepoint. */
export function coerceStartPose(raw: unknown): StartPose | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.headingDeg)) return null;
  let h = (p.headingDeg as number) % 360;
  if (h < 0) h += 360;
  return {
    x: clamp(p.x as number, -C.FIELD_HALF, C.FIELD_HALF),
    y: clamp(p.y as number, -C.FIELD_HALF, C.FIELD_HALF),
    headingDeg: h,
  };
}

export function coerceSetup(s: RobotSetup, game?: GameId): RobotSetup {
  // EVERY per-game answer this function needs comes off the module, not off `game ===`:
  // the anchor count and the start snap. An absent/unknown game resolves to `DEFAULT_GAME`,
  // like every other module lookup.
  const mod = simModuleFor(game);
  const alliance = s.alliance === 'red' || s.alliance === 'blue' ? s.alliance : 'blue';
  // THE GAME IS PASSED ON: `coerceSpec`'s per-game arms (CR's mount fits, BIOBUZZ's own
  // clamps) belong at this chokepoint, which is the last line of defence.
  const spec = coerceSpec(s.spec, DEFAULT_SPEC, game);
  // a custom pose overrides the preset; snap it legal for THIS spec+alliance so no spawn path
  // (localStorage, wire, staged match) can place an illegal robot — ONLY THROUGH THE GAME'S
  // OWN SNAP (`startSnap`). A game without the slot keeps the structurally validated,
  // field-clamped pose and supplies its own fit pass if it has one, as BIOBUZZ's spawn does.
  let startPose: StartPose | undefined;
  const raw = coerceStartPose(s.startPose);
  if (raw) startPose = mod.startSnap ? mod.startSnap(spec, alliance, raw) : raw;
  return {
    id: s.id,
    alliance,
    spec,
    assists: coerceAssists(s.assists),
    // the anchor count is PER GAME (`startPoseCount`) — see `coerceStartIndex`
    startIndex: Number.isFinite(s.startIndex)
      ? clamp(Math.round(s.startIndex), 0, mod.startPoseCount - 1)
      : 0,
    startPose,
    passive: s.passive,
  };
}

/** one robot slot in a match: only filled slots spawn robots */
export interface RobotSetup {
  id: number; // slot index, fixed for the whole match (command-map key)
  alliance: Alliance;
  spec: RobotSpec;
  assists: AssistConfig;
  /** index into the game's named start anchors (mirrored per alliance) — the quick-pick fallback */
  startIndex: number;
  /** a fully-placed CUSTOM start pose (canonical frame). Overrides startIndex when present;
   * `coerceSetup` snaps it legal at spawn. */
  startPose?: StartPose;
  /** an inert obstacle (practice dummy): skips all per-tick action compute (see
   * `RobotState.passive`). */
  passive?: boolean;
}
