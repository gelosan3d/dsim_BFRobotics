import type { Artifact, RobotCommand, RobotState, Vec2, World } from '../types';
import * as C from '../config';
import { footprintExtents, viewAngleOf, type Rect } from './field';
import { rot, clamp, hyp, datan2 } from '../math';
import { activeDrive, driveParams } from './drivetrain';

// ------------------------------------------------------------------ OBB ----

/** collision extents in the robot frame: the intake is a physical part of
 * the robot, so the footprint extends forward by its reach */
export function robotExtents(r: RobotState): { front: number; rear: number; half: number } {
  return footprintExtents(r.spec);
}

export function robotCorners(r: RobotState): Vec2[] {
  const e = robotExtents(r);
  const local = [
    { x: e.front, y: e.half },
    { x: e.front, y: -e.half },
    { x: -e.rear, y: -e.half },
    { x: -e.rear, y: e.half },
  ];
  return local.map((p) => {
    const w = rot(p, r.heading);
    return { x: w.x + r.pos.x, y: w.y + r.pos.y };
  });
}

/** the four wheel ground-contact points (wheel centers), inset INSIDE the
 * chassis — no intake or turret overhang. Base parking counts ONLY these:
 * what touches the floor is what's "in" the zone. */
export function wheelContacts(r: RobotState): Vec2[] {
  const ix = Math.max(r.spec.length / 2 - C.WHEEL_INSET, 1);
  const iy = Math.max(r.spec.width / 2 - C.WHEEL_INSET, 1);
  const local = [
    { x: ix, y: iy },
    { x: ix, y: -iy },
    { x: -ix, y: -iy },
    { x: -ix, y: iy },
  ];
  return local.map((p) => {
    const w = rot(p, r.heading);
    return { x: w.x + r.pos.x, y: w.y + r.pos.y };
  });
}

/** closest point on the robot's OBB (incl. intake) to a world point */
export function closestPointOnRobot(r: RobotState, p: Vec2): Vec2 {
  const e = robotExtents(r);
  const local = rot({ x: p.x - r.pos.x, y: p.y - r.pos.y }, -r.heading);
  const cx = clamp(local.x, -e.rear, e.front);
  const cy = clamp(local.y, -e.half, e.half);
  const w = rot({ x: cx, y: cy }, r.heading);
  return { x: w.x + r.pos.x, y: w.y + r.pos.y };
}

/** SAT intersection test between the robot's OBB and an axis-aligned rect */
export function robotIntersectsRect(r: RobotState, rect: Rect): boolean {
  const rc = robotCorners(r);
  const rectC = [
    { x: rect.x0, y: rect.y0 },
    { x: rect.x1, y: rect.y0 },
    { x: rect.x1, y: rect.y1 },
    { x: rect.x0, y: rect.y1 },
  ];
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    rot({ x: 1, y: 0 }, r.heading),
    rot({ x: 0, y: 1 }, r.heading),
  ];
  for (const ax of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const c of rc) {
      const p = c.x * ax.x + c.y * ax.y;
      aMin = Math.min(aMin, p);
      aMax = Math.max(aMax, p);
    }
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const c of rectC) {
      const p = c.x * ax.x + c.y * ax.y;
      bMin = Math.min(bMin, p);
      bMax = Math.max(bMax, p);
    }
    if (aMax < bMin || bMax < aMin) return false;
  }
  return true;
}

/** velocity of a point rigidly attached to the robot */
export function robotPointVelocity(r: RobotState, p: Vec2): Vec2 {
  const rx = p.x - r.pos.x;
  const ry = p.y - r.pos.y;
  return { x: r.vel.x - r.angVel * ry, y: r.vel.y + r.angVel * rx };
}

// ------------------------------------------------- robot vs static field ----

/** the contact-torque response shared by wall and robot-robot contacts:
 * pushing harder squares up faster (pressure-scaled), the correction never
 * steps past flush, and fast off-axis hits convert speed into visible spin */
/**
 * ONE SURFACE'S CONTRIBUTION, computed and returned rather than written.
 *
 * Surfaces used to each write the heading as they were processed, which makes the result
 * PATH-DEPENDENT: the classifier would rotate the chassis and the gate arm would then work out
 * its own contact geometry against a robot the classifier had already turned. In the corner
 * where the two meet — which is exactly where a driver works the gate — that reads as the
 * collision being erratic, because it is: sweeping the approach across the arm in 1.5in steps
 * gave turns of 2, 0, -9, 0, -7, -17 degrees on the side the classifier is on, against a
 * smooth -6..-8 on the side where the arm answers alone.
 *
 * So each surface returns what it wants, `squareUpStatics` sums them, and the chassis is
 * turned once. Same physics, one answer.
 */
function contactTorqueDelta(
  r: RobotState,
  nx: number,
  ny: number,
  press: number,
  contacts: { c: Vec2; d: number }[],
  squareTo: boolean,
  /**
   * How fast this surface is allowed to turn the robot, against a wall's rate.
   *
   * A wall is the field and squares you at its own pace. The GATE ARM is a hinged bar with a
   * spring's worth of authority, and at the wall's rate it whipped a robot from 20 degrees to
   * flush in 167ms — "the gate applies way too much torque way too fast". Scaling the rate is
   * the honest dial: the direction and the flush cap are geometry and stay exactly as they
   * are, only how quickly it gets there changes.
   */
  rateMult = 1,
  /**
   * Whether this surface's heuristic `spin` flick applies at all.
   *
   * ROBOT-ROBOT passes 0, because a robot pair now takes its rotation from the real two-body
   * point impulse in `squareUpPair` instead — moment arm, both shove masses, both rotational
   * inertias, and a Coulomb friction term. Running both would count one collision twice, and
   * the flick is the half that cannot describe a VICTIM: it scales with the robot's OWN
   * press, so a robot that is not driving gets nothing, which is exactly the case that
   * matters when somebody corners you.
   *
   * Every STATIC surface keeps it at 1. The flick is tuned against the walls, the goal faces
   * and the classifier, its ceilings are pinned by smoke checks, and a full physical rewrite
   * of the static path was tried once and reverted (small angles rocked ±9 degrees).
   */
  spinMult = 1,
): { align: number; spin: number; bleed: boolean; flushErr: number } {
  /**
   * LOAD IS SHARED BY COMPRESSION, and a corner that is not bearing carries none of it.
   *
   * The weight used to be `depth + CONTACT_BIAS`, and that floor is a vote for corners that
   * are not touching: the contact list is everything within CONTACT_TOUCH_EPS of the surface,
   * so a corner half an inch clear still counted. Because the two front corners have
   * different lever arms once the chassis is tilted (the intake extends the front, so they
   * are not mirror images), a floor-weighted vote from the corner that is NOT touching can
   * outweigh the one that is — and the torque comes out the wrong way round. "It's turning me
   * the other way sometimes."
   *
   * Bumpers are compliant, so the honest share is how far each corner is compressed relative
   * to the deepest one: full load at the deepest, nothing beyond CONTACT_COMPLIANCE of it.
   * Square on, all the bearing corners compress equally, their moments cancel, and the robot
   * settles — which is the same equilibrium as before, reached for a reason.
   */
  let dMax = -Infinity;
  for (const { d } of contacts) dMax = Math.max(dMax, d);
  let torque = 0;
  for (const { c, d } of contacts) {
    const load = Math.max(0, Math.min(d, 2) - (Math.min(dMax, 2) - C.CONTACT_COMPLIANCE));
    if (load <= 0) continue;
    const lx = c.x - r.pos.x;
    const ly = c.y - r.pos.y;
    const lever = hyp(lx, ly);
    if (lever < 1e-6) continue;
    torque += ((lx * ny - ly * nx) / lever) * load;
  }
  /**
   * NO LOAD, NO TORQUE. A surface turns a robot because the robot is pressing on it; a robot
   * that is merely TOUCHING one has nothing pushing it round.
   *
   * The gain used to be `1 + press * CONTACT_PRESS_GAIN` — a floor of 1, which means a
   * geometric `torque` alone rotates the chassis at zero press. Against a face it hides,
   * because the flush cap stops it as soon as the robot is square; against the gate handle,
   * which is a point and has no flush to stop at, a robot parked beside it turned 359.6
   * degrees on its own: "torque is being applied with me not doing anything."
   */
  const gain = press * C.CONTACT_PRESS_GAIN;
  const none = { align: 0, spin: 0, bleed: false, flushErr: Infinity };
  if (gain <= 0) return none;
  const rate = Math.min(C.CONTACT_ALIGN_RATE * gain, C.CONTACT_ALIGN_RATE_MAX) * rateMult;
  // never step PAST flush: cap the correction at the remaining tilt (the
  // chassis is square, so flush poses repeat every 90°). Without this cap the
  // torque bias overshoots each tick and the heading buzzes at the wall.
  let flushErr = Infinity;
  let relSigned = 0;
  if (squareTo) {
    const q = Math.PI / 2;
    let rel = r.heading - datan2(ny, nx);
    rel -= Math.round(rel / q) * q;
    relSigned = rel;
    flushErr = Math.abs(rel);
  }
  const cap = Math.min(rate, flushErr);
  let align = clamp(torque * 0.1 * gain * rateMult, -cap, cap);
  /**
   * A SETTLING RESPONSE SETTLES. It may reduce the tilt against a FACE and may not add to it —
   * adding to it is what a collision does, and that is the impulse, which is free to.
   *
   * Near flush the contact levers nearly cancel and what is left is small and noisy. When the
   * noise came out the wrong way the alignment ran with it, and because the cap is the
   * remaining tilt, every wrong step licensed a bigger one: measured, 3 degrees off square
   * into a wall at speed ended 13 degrees off, the wrong side.
   */
  if (squareTo && align * relSigned > 0) align = 0;
  /**
   * The impulse a collision hands the chassis. Unlike the alignment it is angular VELOCITY, so
   * it is not capped at the remaining tilt — a hard hit keeps turning you after the contact
   * has done its work, which is what "even if I hit it with a large impact it doesn't turn me"
   * was asking for. It is guarded against the TILT and not against `align`, because comparing
   * it to `align` passes trivially whenever `align` has been zeroed for pointing the wrong way
   * — exactly when the guard is needed.
   */
  const spinRaw = torque * press * C.CONTACT_IMPACT_SPIN * rateMult * spinMult;
  const spin = !squareTo || spinRaw * relSigned <= 0 ? spinRaw : 0;
  return { align, spin, bleed: r.angVel * align < 0, flushErr };
}

/** turn the chassis by a summed contact response */
function applyTurn(
  r: RobotState,
  d: { align: number; spin: number; bleed: boolean; flushErr: number },
): void {
  if (d.align === 0 && d.spin === 0) return;
  const maxTurn = driveParams(r.spec).maxTurn;
  r.heading += d.align;
  if (d.bleed) {
    // bleed angular velocity that fights the contact — a surface being pressed does not let
    // the chassis keep spinning into it
    r.angVel *= 0.9;
  } else if (d.spin !== 0) {
    r.angVel = clamp(r.angVel + d.spin, -maxTurn, maxTurn);
  }
}

// ------------------------------------------- square-up (Rapier robot slice) --
// Rapier (physicsEngine.ts) now owns robot translation + velocity: wall/robot
// pushout, velocity-kill, mass-weighted shoving. These run AFTER the Rapier
// solve and add ONLY the bespoke pieces Rapier isn't: the contact-torque "square
// up flush" nudge (rotation) and the robot-robot contact record for penalties.

/** how hard the robot was driving INTO a contact (in/s), from its PRE-solve
 * velocity — scales the square-up torque (a fast hit swings hard; a settled
 * chassis barely turns) */
/**
 * How hard the robot is driving INTO the surface, in in/s of refused approach.
 *
 * Deliberately the pre-solve APPROACH, not the momentum the solve took out. The delivered-push
 * reading was tried and it is zero exactly when it is needed: once a robot is resting on a
 * wall its velocity into the wall is already gone before this pass runs, so the settling
 * torque vanishes and a robot leaning at an angle stays there. What this measures is the load
 * the drive is holding against the surface, which is what presses a chassis flat.
 */
function pressAlong(preVel: Vec2 | undefined, nx: number, ny: number): number {
  if (!preVel) return 0;
  const vn = preVel.x * nx + preVel.y * ny; // >0 = moving along the push (outward)
  return vn < 0 ? -vn : 0; // driving IN
}

/**
 * ...AND THE LOAD SOMEBODY ELSE IS PUTTING THROUGH YOU INTO IT.
 *
 * `pressAlong` reads the robot's OWN drive, which is the whole story for a robot leaning on a
 * wall of its own accord and none of it for one held there by an opponent. Measured: a 42 lb
 * tank rams an idle robot into the field corner and the victim sits at the 22.9-degree tilt it
 * arrived with for four seconds — it never squares up, because by its own reckoning nothing is
 * pressing on it.
 *
 * `ext` is the push a robot is receiving from robot-robot contacts this tick, summed as a
 * vector in the same units `pressAlong` returns (in/s of refused approach per tick). Its
 * component pointing INTO this surface (the −n direction; `n` is the way the surface pushes
 * the robot out) is load the surface must hold, and the chassis flattens against it just as it
 * would under its own drive.
 *
 * MAX, not sum. Physically the two loads add, but the alignment rate saturates at roughly
 * 4.2 in/s of press and a robot driving into something re-injects about that much every tick,
 * so summing changes nothing there — while the uncapped `spin` flick would double on a robot
 * that is both driving and being shoved. Taking the larger of the two sources is the honest
 * reading of "what is holding this chassis against the surface" without that risk.
 */
function pressOn(preVel: Vec2 | undefined, ext: Vec2 | undefined, nx: number, ny: number): number {
  const own = pressAlong(preVel, nx, ny);
  if (!ext) return own;
  const into = -(ext.x * nx + ext.y * ny);
  return into > own ? into : own;
}

/**
 * ONE TICK'S CONTACT RESPONSE FOR THE WHOLE FIELD, collected before any of it is written.
 *
 * `deltas` are the settling contributions (`sumTurn` folds them), `dw` is angular velocity
 * from real collision impulses, and `ext` is the robot-robot push each chassis is carrying,
 * which the static surfaces then read through `pressOn`.
 *
 * IT EXISTS BECAUSE THE PAIRS USED TO WRITE FIRST. `squareUpRobots` ran every robot-robot pair
 * to completion — rotating both chassis — and only then asked the walls, the goal faces, the
 * classifier and the gate arm what they thought, so those surfaces worked out their contact
 * geometry against a robot an opponent had already turned. That is exactly the path-dependence
 * `sumTurn` was written to kill for the statics, with the robot-robot half left outside it; in
 * a three-robot pile it also meant the answer depended on which robot held which id (measured:
 * the same geometry with the ids permuted landed ~1in and ~1.2 degrees apart).
 *
 * Now every surface and every pair reads the SAME pose — the one the Rapier solve left — and
 * the writes happen once per robot at the end.
 */
type ContactAcc = {
  deltas: Map<number, TurnDelta[]>;
  ext: Map<number, Vec2>;
};

function newAcc(): ContactAcc {
  return { deltas: new Map(), ext: new Map() };
}

/** this robot's delta list, created on demand — the static pass appends to the same array
 * the pair pass filled, so one `sumTurn` sees every surface touching this chassis. */
function accList(acc: ContactAcc, id: number): TurnDelta[] {
  let list = acc.deltas.get(id);
  if (!list) {
    list = [];
    acc.deltas.set(id, list);
  }
  return list;
}

function accPush(acc: ContactAcc, id: number, nx: number, ny: number, press: number): void {
  const v = acc.ext.get(id);
  if (v) {
    v.x += nx * press;
    v.y += ny * press;
  } else {
    acc.ext.set(id, { x: nx * press, y: ny * press });
  }
}

/**
 * Write one robot's accumulated contact response: the collision impulses first, then the
 * settling nudge, mirroring the order `squareUpStatics` already uses for the gate handle.
 *
 * The impulse turns the CHASSIS by `dw · dt` as well as adding to `angVel`, because the
 * drivetrain owns `angVel` and `motorStep` pulls it back toward the commanded turn at
 * turnAccel — hundreds of rad/s² — which erases anything a contact injects before the next
 * tick's heading integration ever sees it. Setting `angVel` alone is a rotation that never
 * happens. So the hit turns you now and the wheels fight what is left, which is the real pair.
 *
 * `angVel` stays clamped to the robot's own `maxTurn`: it is a generous ceiling (≈487°/s on
 * the default chassis) that only a violent hit reaches, and the wall checks pin the peak a
 * contact may produce.
 */
function applyAcc(world: World, acc: ContactAcc): void {
  for (const r of world.robots) {
    // a robot on an auto path has its pose written by the path, not by contact
    if (!r.autoPathActive) {
      const deltas = acc.deltas.get(r.id);
      if (deltas) sumTurn(r, deltas);
    }
    /**
     * ...AND THE STEP ENDS WITH NOBODY MOVING FASTER THAN A ROBOT CAN.
     *
     * The same solver-explosion guard `solveRobots` applies on write-back, repeated here so it
     * holds for the WHOLE robot phase rather than for one pass of it. The bespoke passes add
     * velocity too — the gate handle resolves a point impulse straight onto `r.vel` — so a
     * robot crushed against structure could still leave this function at 812 in/s after the
     * solve had been bounded. Dead code in ordinary play; if it ever binds there, something
     * upstream is wrong.
     */
    const speed = hyp(r.vel.x, r.vel.y);
    if (speed > C.PHYS_MAX_ROBOT_SPEED) {
      r.vel.x *= C.PHYS_MAX_ROBOT_SPEED / speed;
      r.vel.y *= C.PHYS_MAX_ROBOT_SPEED / speed;
    }
  }
}

/** torque-only static square-up: Rapier already resolved translation, so this
 * only rotates a tilted chassis flush against walls / goal faces / classifier
 * structures it is resting on. Detection mirrors constrainRobot; `preVel` gives
 * the drive-in pressure the torque scales with. */
/** square a tilted chassis flush against the four perimeter walls at ±halfX / ±halfY.
 * Shared by DECODE (`squareUpStatics`) and Chain Reaction (`squareUpRobotsWalls`) — the
 * wall-alignment torque that makes a robot driving into a wall settle parallel to it. */
type TurnDelta = { align: number; spin: number; bleed: boolean; flushErr: number };

/**
 * SUM THE SURFACES, THEN TURN ONCE.
 *
 * Every surface a robot is touching this tick contributes its own answer, and they are added
 * before anything is written. Writing them one at a time makes the result path-dependent — the
 * classifier turns the chassis and the gate arm then works out its contact geometry against a
 * robot the classifier has already moved — and in the corner where the two meet, which is
 * exactly where a driver works the gate, that reads as the collision being erratic. It was:
 * sweeping the approach across the arm in 1.5in steps gave 2, 0, -9, 0, -7, -17 degrees on the
 * side the classifier is on, against a smooth -6..-8 where the arm answers alone.
 *
 * The alignment sums (two surfaces both squaring you agree, and a face fighting a stub nets
 * out), and the flush cap that survives is the TIGHTEST one any FACE in the set imposes —
 * because rotating past any of them would be rotating into it.
 */
function sumTurn(r: RobotState, deltas: TurnDelta[]): void {
  if (deltas.length === 0) return;
  let align = 0;
  let spin = 0;
  let bleed = false;
  let cap = Infinity;
  for (const d of deltas) {
    align += d.align;
    spin += d.spin;
    if (d.bleed) bleed = true;
    if (d.flushErr < cap) cap = d.flushErr;
  }
  applyTurn(r, { align: clamp(align, -cap, cap), spin, bleed, flushErr: cap });
}

function squareUpWalls(
  r: RobotState,
  preVel: Vec2 | undefined,
  halfX: number,
  halfY: number,
  out: TurnDelta[],
  ext: Vec2 | undefined,
): void {
  const eps = C.CONTACT_TOUCH_EPS;
  const corners = robotCorners(r);
  const walls: [number, number, (c: Vec2) => number][] = [
    [-1, 0, (c) => c.x - halfX],
    [1, 0, (c) => -halfX - c.x],
    [0, -1, (c) => c.y - halfY],
    [0, 1, (c) => -halfY - c.y],
  ];
  for (const [nx, ny, depthOf] of walls) {
    const contacts: { c: Vec2; d: number }[] = [];
    for (const c of corners) {
      const d = depthOf(c);
      if (d > -eps) contacts.push({ c, d: Math.max(d, 0) });
    }
    if (contacts.length > 0) out.push(contactTorqueDelta(r, nx, ny, pressOn(preVel, ext, nx, ny), contacts, true));
  }
}

/**
 * ROBOT-ROBOT CONTACT: the record the penalty engine reads, the settling nudge, and the
 * rotation Rapier cannot produce.
 *
 * Rapier resolved the shove (translation + velocity) with rotations LOCKED, so a chassis
 * carries no angular response out of the solve at all. This supplies it, and it supplies the
 * ONE number both robots' responses are scaled by: the CLOSING velocity along the contact
 * normal.
 *
 * THE PRESS IS RELATIVE, AND IT USED NOT TO BE. Each robot's press was its own ABSOLUTE
 * velocity projected on the normal — a load reading that does not need the other robot to be
 * there at all. Two robots cruising side by side in contact, no relative motion and nothing
 * compressed, squared each other up at 0.45 rad/s; a pair actively SEPARATING (gap 14.7in to
 * 19.5in over half a second) still had the trailing one snapped from 11.46 degrees to flush.
 * A contact that is opening cannot carry a load, and `contactTorqueDelta`'s own rule is "no
 * load, no torque" — the rule was right, the input was wrong.
 *
 * `out` (rrContacts) is recorded BEFORE any of that, on geometric overlap alone. Every
 * protected-zone rule in both games reads it — G424/G425/G426/G427/G402/G422/G408 and CR's
 * G05/G06 — and touching an opponent in their loading zone is a foul whether or not either of
 * you is pressing.
 */
function squareUpPair(
  a: RobotState,
  b: RobotState,
  preVels: Map<number, Vec2>,
  out: { a: number; b: number }[],
  acc: ContactAcc,
): void {
  const ca = robotCorners(a);
  const cb = robotCorners(b);
  const axes = [
    rot({ x: 1, y: 0 }, a.heading),
    rot({ x: 0, y: 1 }, a.heading),
    rot({ x: 1, y: 0 }, b.heading),
    rot({ x: 0, y: 1 }, b.heading),
  ];
  let minPen = Infinity;
  const found: { axis: Vec2; ov: number }[] = [];
  for (const ax of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    for (const c of ca) {
      const p = c.x * ax.x + c.y * ax.y;
      if (p < aMin) aMin = p;
      if (p > aMax) aMax = p;
    }
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const c of cb) {
      const p = c.x * ax.x + c.y * ax.y;
      if (p < bMin) bMin = p;
      if (p > bMax) bMax = p;
    }
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap <= -C.CONTACT_TOUCH_EPS) return; // clearly separated
    found.push({ axis: ax, ov: overlap });
    if (overlap < minPen) minPen = overlap;
  }

  /**
   * THE NORMAL AT A CORNER IS BETWEEN THE TWO FACES THAT MEET THERE — the same correction
   * `mtvOf` already makes for the gate handle and the classifier, for the same reason.
   *
   * Plain SAT returns the single least-overlapping axis, which is right in the middle of a
   * face and ill-conditioned at a corner: two of the four candidates sit within numerical
   * noise of each other and the normal flips between them as the chassis slide a hair past
   * the diagonal. Corner-on-corner is most of what robot-robot contact IS, so axes within
   * CONTACT_NORMAL_BLEND of the minimum are summed, weighted by how close each is to being
   * the answer. Away from a corner the second axis carries no weight and this is plain SAT.
   */
  let bx = 0;
  let by = 0;
  for (const { axis, ov } of found) {
    const w = 1 - (ov - minPen) / C.CONTACT_NORMAL_BLEND;
    if (w <= 0) continue;
    const flip = (b.pos.x - a.pos.x) * axis.x + (b.pos.y - a.pos.y) * axis.y < 0 ? -1 : 1;
    bx += axis.x * flip * w;
    by += axis.y * flip * w;
  }
  const bl = hyp(bx, by);
  if (bl < 1e-9) return;
  const nx = bx / bl; // a -> b: the way the contact pushes b, and pushes a back along
  const ny = by / bl;

  out.push(a.id < b.id ? { a: a.id, b: b.id } : { a: b.id, b: a.id });

  /**
   * ...AND THAT IS NEARLY ALL THIS PASS DOES NOW — slice A.
   *
   * Everything else that used to live here was standing in for an angular response Rapier was
   * not allowed to give: the bodies were rotation-LOCKED, so an off-centre hit produced no yaw
   * at all and a two-body point impulse had to be hand-rolled, scaled by `CONTACT_PAIR_SPIN`
   * because taking only its rotation left out everything that relieves a sustained contact; a
   * settling nudge flattened a held pair toward flush; `CONTACT_SLIP_RELIEF` stopped that
   * settling term steering a pusher after its victim; and `capDrag` bounded a friction that an
   * imposed velocity had made unbounded in the first place.
   *
   * The bodies rotate now and the drive arrives as a force, so the solver produces all of it
   * out of the same normal and friction impulses — off-centre hits, flank drags, a held pair
   * bearing itself flush. Keeping the heuristics on top would double it, and measurably did:
   * with both running, an off-centre ram spun its victim 26.3 degrees where the old model gave
   * 12.6.
   *
   * TWO THINGS SURVIVE, because neither of them is a rotation:
   *   · `rrContacts`, recorded above on geometric overlap alone — every protected-zone rule in
   *     both games reads it, and touching an opponent in their zone is a foul whether or not
   *     anybody is pressing.
   *   · the transmitted PUSH below, which is how a robot held against a wall by an opponent
   *     feels that opponent's load in the STATIC pass (`pressOn`). Rapier resolves the contact
   *     but does not tell the bespoke wall aligner who is leaning on whom.
   */
  const pva = preVels.get(a.id) ?? a.vel;
  const pvb = preVels.get(b.id) ?? b.vel;
  const press = (pva.x - pvb.x) * nx + (pva.y - pvb.y) * ny; // > 0 = closing
  if (press <= 0) return; // touching but unloaded — nothing transmitted

  accPush(acc, a.id, -nx, -ny, press);
  accPush(acc, b.id, nx, ny, press);
}

/**
 * WHERE A ROBOT IS ASKING TO GO, in the WORLD frame, as a fraction of full stick.
 *
 * The same decode `updateRobot` does - tank reads its two side-drives, everything else the
 * stick, and a field-centric stick only has the camera undone - kept in ONE place because two
 * consumers now ask the question and a second copy would drift from the drive model. G422's
 * "attempting to move" normalizes this; `capDrag` uses its magnitude.
 */
export function driveIntent(r: RobotState, cmd: RobotCommand | undefined): Vec2 {
  if (!cmd) return { x: 0, y: 0 };
  const tank = activeDrive(r.spec, r.butterflyTank).p.saturation === 'tank';
  return !tank && r.fieldCentric
    ? rot({ x: cmd.driveX, y: cmd.driveY }, -viewAngleOf(r.alliance))
    : rot(
        tank
          ? { x: ((cmd.leftDrive ?? 0) + (cmd.rightDrive ?? 0)) / 2, y: 0 }
          : { x: cmd.driveY, y: -cmd.driveX },
        r.heading,
      );
}

/** every robot-robot pair, in a stable id order (determinism). Shared by both games. */
function squareUpPairs(world: World, preVels: Map<number, Vec2>, acc: ContactAcc): void {
  for (let i = 0; i < world.robots.length; i++) {
    for (let j = i + 1; j < world.robots.length; j++) {
      squareUpPair(world.robots[i], world.robots[j], preVels, world.rrContacts, acc);
    }
  }
}

/** post-Rapier square-up for a game whose only statics are perimeter WALLS (Chain
 * Reaction). Same robot-robot pass as DECODE, but the static half aligns to the four walls
 * at ±halfX/±halfY only — no DECODE goal-face / classifier geometry. This is what makes a CR
 * robot settle flush when it drives into a wall. */
export function squareUpRobotsWalls(
  world: World,
  preVels: Map<number, Vec2>,
  halfX: number,
  halfY: number,
): void {
  const acc = newAcc();
  squareUpPairs(world, preVels, acc);
  for (const r of world.robots) {
    if (r.autoPathActive) continue; // the path owns the pose — see squareUpRobots
    squareUpWalls(r, preVels.get(r.id), halfX, halfY, accList(acc, r.id), acc.ext.get(r.id));
  }
  applyAcc(world, acc);
}

/**
 * WHAT `squareUpRobotsWalls` WOULD TURN EACH ROBOT BY, WITHOUT TURNING IT — the change to
 * `heading` and to `angVel`, for robots it would change. Nothing is written: not the robots, not
 * `world.rrContacts`.
 *
 * For a pipeline whose solver must make the turn itself. BIOBUZZ 3D (`sim3d/step3dImpl.ts`) runs a
 * PERSISTENT Rapier world, and a heading written after its solve reaches the body next tick as a
 * rotation teleport of up to `CONTACT_ALIGN_RATE_MAX` — a corner moved ~0.2 in into or off the wall,
 * which the solver pushes back, and the two alternate every tick while a robot squares up. Its
 * outcome then hangs on contact state the snapshot does not carry, so the client's prediction and
 * the room part ways at walls: the "invisible bump" (2026-10-02). There the turn is handed to the
 * solve as spin instead. The 2D solves rebuild their world every tick and keep the post-solve write.
 */
export function squareUpTurnsWalls(
  world: World,
  preVels: Map<number, Vec2>,
  halfX: number,
  halfY: number,
): Map<number, { dHeading: number; dAngVel: number }> {
  const acc = newAcc();
  // the pair pass also RECORDS contacts; this is not the tick's record, so it writes to a copy
  squareUpPairs({ ...world, rrContacts: [] }, preVels, acc);
  const out = new Map<number, { dHeading: number; dAngVel: number }>();
  for (const r of world.robots) {
    if (r.autoPathActive) continue;
    squareUpWalls(r, preVels.get(r.id), halfX, halfY, accList(acc, r.id), acc.ext.get(r.id));
    const deltas = acc.deltas.get(r.id);
    if (!deltas || deltas.length === 0) continue;
    // `sumTurn` writes `heading` and `angVel` and nothing else, so a shallow copy takes the turn
    const t = { ...r };
    sumTurn(t, deltas);
    const dHeading = t.heading - r.heading;
    const dAngVel = t.angVel - r.angVel;
    if (dHeading !== 0 || dAngVel !== 0) out.set(r.id, { dHeading, dAngVel });
  }
  return out;
}

/** the RECORD half of `squareUpRobotsWalls` — `rrContacts` and the end-of-phase speed guard, no
 * turn — for a pipeline that took the turn inside its solve (`squareUpTurnsWalls`) */
export function recordRobotContacts(world: World, preVels: Map<number, Vec2>): void {
  const acc = newAcc();
  squareUpPairs(world, preVels, acc);
  applyAcc(world, { deltas: new Map(), ext: acc.ext });
}

// ------------------------------------------------------------ ball steps ----

/** rolling friction + rest-snap for a ground ball, velocity ONLY. Rapier owns
 * the position integration + all contact now (unified solve), so this no longer
 * advances position — it just decays speed each tick before the solve reads the
 * ball's linvel (mirrors how updateRobot stopped integrating robot position). */
export function stepGroundBall(b: Artifact, dt: number): void {
  const speed = hyp(b.vel.x, b.vel.y);
  if (speed > 0) {
    const ns = speed - C.BALL_ROLL_FRICTION * dt;
    if (ns <= 0 || ns < C.BALL_REST_SPEED) {
      b.vel.x = 0;
      b.vel.y = 0;
    } else {
      const k = ns / speed;
      b.vel.x *= k;
      b.vel.y *= k;
    }
  }
}
