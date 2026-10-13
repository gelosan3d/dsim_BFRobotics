import RAPIER from '@dimforge/rapier2d-compat';
import type { Artifact, RobotState, Vec2, World } from '../types';
import * as C from '../config';
import { robotExtents } from './physics';
import { type RobotSolids, type SolidShape } from './artifactSolids';
import { shoveMass } from './drivetrain';
import type { DriveWrench } from './robot';
import { chassisInertia } from './robot';
import { clamp, dcos, dsin, hyp, wrapAngle } from '../math';
import type { FieldColliders } from '../games/types';

/**
 * Rapier 2D physics bridge (netcodeplan Phase 2, robots-first slice).
 *
 * The sim's `World` stays the single canonical, JSON-serializable source of
 * truth. Each `step()` builds a FRESH Rapier world from the robots' current
 * poses, steps it once, and writes the resolved translation + velocity back —
 * then frees it. Statelessness is deliberate: `game.ts` reconcile swaps
 * `this.world` for a fresh snapshot up to 60×/s, so a Rapier world keyed to
 * object identity would rebuild-and-leak WASM every frame. Rebuild-per-step
 * makes reconcile and bit-for-bit determinism trivially correct, and building
 * a handful of colliders + N bodies is microseconds.
 *
 * Rapier OWNS robot translation, velocity AND rotation (→ wall/robot velocity-kill,
 * mass-weighted shoving, restitution-0 inelastic contact). The drive reaches it as a
 * FORCE + TORQUE (`DriveWrench`), so the angular half of a contact is the solver's own
 * answer rather than a heuristic; the bespoke contact-torque "square up flush" nudge stays
 * in physics.ts (`squareUpRobots`), the one piece the plan calls out as not a Rapier
 * primitive.
 *
 * GROUND artifacts are a second solve (`solveArtifacts`) in the same tick, and the two are
 * run as ROUNDS (the loop in `world.ts` `step`): the robot solve first, with every artifact
 * PINNED against the field or another robot standing in it as a fixed circle (`R_PIN`) that
 * the chassis solids (`R_CSOL`, from `artifactSolids`) cannot pass; then the artifact solve,
 * with every robot a KINEMATIC body sweeping from where it began the tick to where the robot
 * solve put it, carrying the same `artifactSolids` shapes as colliders. `pinnedArtifacts`
 * then asks which artifacts are being squeezed (with hysteresis and a transitive support
 * test), and if the set GREW the tick is re-run from the snapshot with the new pins — so an
 * artifact pressed between a bumper and a wall is the thing the ROBOT stops on, not the thing
 * the artifact solve is asked to squirt out of the way. ONE geometry authority for what on a
 * robot is solid (`artifactSolids.ts`) is what lets the two solves and the pin test agree;
 * the intake mouth is open in all three by design. Restitution and friction both combine
 * with `Min` on the artifact side, so the per-pair coefficients fall straight out of the
 * BALL_* and INTAKE_* constants. FLIGHT balls (ballistic + rare low collisions) stay bespoke
 * in world.ts / physics.ts, as do the basin, the rail and the gate.
 */

let ready = false;

/** Load + init the Rapier WASM (async). MUST resolve before any `step()` runs;
 * awaited at every entry point (smoke, server, browser). Idempotent. */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

export function physicsReady(): boolean {
  return ready;
}

/** give a static field collider a ball-bounce restitution combined with Min, so
 * a ground ball caroms off it at BALL_WALL_RESTITUTION while a robot (restitution
 * 0) still resolves fully inelastically against it — slice-1 robot feel intact. */
function statics(desc: RAPIER.ColliderDesc, groups?: number, friction: number = C.PHYS_WALL_FRICTION): RAPIER.ColliderDesc {
  const d = desc
    // stated, not inherited — see PHYS_WALL_FRICTION; the artifact world passes its own
    .setFriction(friction)
    .setRestitution(C.BALL_WALL_RESTITUTION)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  // Only the ARTIFACT solve names a group here (see FIELD_GROUP). Left unset everywhere else,
  // so the robot solve gets Rapier's default membership and is untouched to the digit.
  return groups === undefined ? d : d.setCollisionGroups(groups);
}

/** build a game's static field colliders (perimeter walls + structures) onto the
 * fresh world, in the module's stable spec order (determinism). The geometry math
 * is memoized in the game module (`FieldColliders.statics`). */
function buildStatics(rw: RAPIER.World, colliders: FieldColliders, groups?: number, friction?: number): void {
  for (const s of colliders.statics) {
    rw.createCollider(
      statics(
        RAPIER.ColliderDesc.cuboid(s.hx, s.hy).setTranslation(s.tx, s.ty).setRotation(s.rot),
        groups,
        friction,
      ),
    );
  }
}

/** a fresh Rapier world with our inch-scale tolerances + the static field
 * colliders. Shared by the robot and ball solves. Robots use SOFT contacts
 * (a robot can start a step deep inside a wall via its intake reach — a stiff
 * contact would eject it explosively); balls are small and slow and never start
 * deeply embedded, so they use STIFF contacts (`freq`/`allowedError`) that push
 * an overlapping pair fully apart in one step instead of leaving them visibly
 * interpenetrating for several ticks. */
function makeWorld(
  dt: number,
  colliders: FieldColliders,
  freq: number = C.PHYS_CONTACT_FREQ,
  allowedError: number = C.PHYS_ALLOWED_ERROR,
  staticGroups?: number,
  staticFriction?: number,
): RAPIER.World {
  const rw = new RAPIER.World({ x: 0, y: 0 }); // top-down plane: no gravity
  rw.timestep = dt;
  // Rapier's tolerances default to METERS; our world is in INCHES (~40× bigger),
  // so tell it the typical object scale. Without this the penetration-error and
  // corrective-velocity caps are mis-scaled and a robot driven full-speed into a
  // wall-pinned robot out-runs the solver — penetration grows until the min-axis
  // flips and the pair is ejected sideways. Extra iterations keep deep contacts
  // (a full-speed pin) fully projected out each step, like the old solver did.
  rw.integrationParameters.lengthUnit = C.PHYS_LENGTH_UNIT;
  rw.integrationParameters.numSolverIterations = C.PHYS_SOLVER_ITERS;
  rw.integrationParameters.contact_natural_frequency = freq;
  rw.integrationParameters.normalizedAllowedLinearError = allowedError;
  buildStatics(rw, colliders, staticGroups, staticFriction);
  return rw;
}

/**
 * How much of `now`'s overhang has to be given back: whatever takes it past the larger of what
 * the robot already had and the resting slop. Signed — + is past the high wall, − the low.
 *
 * THE SLOP IS LOAD-BEARING. Ordinary soft contact leaves a chassis resting a little into a wall
 * (0.57in at the worst measured shove), and a containment pass that fought that every tick is
 * precisely the two-passes-taking-turns failure the artifact solve had to be rebuilt to avoid —
 * tried without it, and the wall square-up lost flush by 1.4 degrees while artifacts started
 * jittering against the classifier again. Above the worst honest penetration, far below
 * "outside the field", so it only ever acts once the solver has already given up.
 */
function grewOut(now: number, was: number): number {
  const allowed = Math.max(Math.abs(was), C.PHYS_CONTAIN_SLOP);
  const over = Math.abs(now) - allowed;
  return over > 0 ? (now > 0 ? over : -over) : 0;
}

/**
 * How far a robot's footprint sticks out past the perimeter, as an outward vector (0 inside).
 *
 * Used by `solveRobots` to hold a containment invariant the colliders alone cannot: a robot
 * that began a tick INSIDE the field may not be pushed out of it. That was true for free while
 * every body in the solve was dynamic and would yield, and stopped being true the moment one
 * of them could not — a chassis crushed between the far wall and a robot on an AUTO PATH
 * (kinematic; it does not give) was driven 15.2in past the wall, and with a longer path left
 * the field entirely. No speed guard can see that: Rapier's positional correction does not feed
 * velocity, so the victim's `r.vel` read 0.00 for every tick it was being pushed through. The
 * violation is positional, so the answer has to be.
 *
 * IT CLAMPS THE GROWTH, NOT THE VALUE. A robot may legitimately be outside already — DECODE's
 * outflow mouth sits at x = -69 inside the classifier channel, and a probe parked on it has its
 * whole chassis past the wall plane — and a pass that hauled such a robot back in would be
 * overriding a pose nothing put it in. Containment keeps you in; it does not teleport you in.
 */
function outsideBy(r: RobotState, bounds: { halfX: number; halfY: number }): Vec2 {
  const e = robotExtents(r);
  const c = dcos(r.heading);
  const s = dsin(r.heading);
  // the footprint's axis-aligned half-extents, which is all an axis-aligned wall can see
  const hx = (e.front + e.rear) / 2;
  const cx = r.pos.x + ((e.front - e.rear) / 2) * c;
  const cy = r.pos.y + ((e.front - e.rear) / 2) * s;
  const ax = Math.abs(hx * c) + Math.abs(e.half * s);
  const ay = Math.abs(hx * s) + Math.abs(e.half * c);
  return {
    x: Math.max(0, cx + ax - bounds.halfX) + Math.min(0, cx - ax + bounds.halfX),
    y: Math.max(0, cy + ay - bounds.halfY) + Math.min(0, cy - ay + bounds.halfY),
  };
}

export function solveRobots(
  world: World,
  dt: number,
  colliders: FieldColliders,
  /** the DRIVE, as a force + torque per robot id (`updateRobot`). Absent ⇒ this robot is
   *  coasting: the solver still owns its motion, nothing is being asked of the wheels. */
  drive?: Map<number, DriveWrench>,
): Map<number, Vec2> {
  const preVels = new Map<number, Vec2>();
  const robots = world.robots;
  if (robots.length === 0) return preVels;

  const rw = makeWorld(dt, colliders, undefined, undefined, R_STAT);
  const bodies: { r: RobotState; body: RAPIER.RigidBody; wasOut: Vec2 }[] = [];
  for (const r of robots) {
    // Always record preVels for all robots, even if Rapier will not move this one
    preVels.set(r.id, { x: r.vel.x, y: r.vel.y });

    const e = robotExtents(r);
    const hx = (e.front + e.rear) / 2;
    const forward = (e.front - e.rear) / 2; // intake reach shifts the box forward
    /**
     * ROTATION IS NOT LOCKED ANY MORE — slice A.
     *
     * It was, and everything angular had to be hand-built around that: the two-body
     * impulse in `squareUpPair`, the settling nudge, `CONTACT_PAIR_SPIN`, the slip
     * relief. A locked body cannot yaw from a contact, so an off-centre hit produced
     * nothing at all and the bespoke pass existed to put it back.
     *
     * With the drive arriving as a force (see `updateRobot`), the solver can answer the
     * angular half itself, from the same normal and friction impulses it already
     * computes — a flank drag yaws you because the friction acts off the centre of mass,
     * not because a heuristic says so.
     */
    const body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(r.pos.x, r.pos.y)
        .setRotation(r.heading)
        .setLinvel(r.vel.x, r.vel.y)
        .setAngvel(r.angVel),
    );
    // PUSHING POWER. `shoveMass` is the collider mass that DELIVERS this robot's
    // `pushForce` given the accel the motor model used — see drivetrain.ts, which owns
    // the whole model and documents why the force cannot simply be written here as a
    // mass. BUTTERFLY: the set that is DOWN decides both the traction factor and the
    // gearing, so dropping the traction wheels really does turn it into a pusher
    // mid-match (and back) — `r.butterflyTank` carries that into both terms.
    /**
     * ...AND THE MASS PROPERTIES ARE STATED, not derived from the box.
     *
     * `setMass` alone would put the centre of mass at the FOOTPRINT's centre, which sits
     * forward of the chassis by half the intake reach — so a robot would pivot about a point
     * out in front of itself and the drive model's `maxTurn` (worked out about the chassis
     * centre, from its half-diagonal) would no longer be the free-space answer. The COM is
     * pinned back to the body origin and the inertia is the chassis rectangle's, which is the
     * same expression `squareUpPair`'s impulse already used — so nothing in the sim disagrees
     * about how hard this robot is to spin.
     */
    const m = shoveMass(r.spec, r.butterflyTank, r.powerDraw);
    rw.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, e.half)
        .setTranslation(forward, 0) // body-local (rotated by heading)
        .setMassProperties(m, { x: -forward, y: 0 }, chassisInertia(m, r.spec))
        .setRestitution(0)
        .setFriction(C.PHYS_FRICTION)
        .setCollisionGroups(R_FOOT),
      body,
    );
    // the DRIVE, for this tick. A pure force acts at the centre of mass and a pure torque
    // about it, so the two are independent: driving forward never yaws you by itself.
    const w = drive?.get(r.id);
    if (w) {
      if (w.fx !== 0 || w.fy !== 0) body.addForce({ x: w.fx, y: w.fy }, true);
      if (w.tau !== 0) body.addTorque(w.tau, true);
    }
    bodies.push({ r, body, wasOut: outsideBy(r, colliders.bounds) });
  }

  rw.step();

  for (const { r, body, wasOut } of bodies) {
    const p = body.translation();
    const v = body.linvel();
    r.pos.x = p.x;
    r.pos.y = p.y;
    // ...and it may not have been pushed FURTHER out than it already was (see `outsideBy`).
    const nowOut = outsideBy(r, colliders.bounds);
    r.pos.x -= grewOut(nowOut.x, wasOut.x);
    r.pos.y -= grewOut(nowOut.y, wasOut.y);
    /**
     * A SOLVER-EXPLOSION GUARD, not a gameplay lever.
     *
     * Nothing on this field can legitimately carry a robot past a couple of times its own top
     * speed: the hardest thing that can happen to it is being rammed by another robot, and no
     * robot goes faster than ~94 in/s. A larger number is the solver failing to satisfy an
     * over-constrained contact, and there is exactly one way to over-constrain it — squeeze a
     * dynamic chassis between something immovable and something that will not yield.
     *
     * That case existed while DECODE's AUTO PATHS ran a robot as a kinematic body, advancing
     * regardless of what was in front of it: when the bystander it had been carrying reached a
     * wall the two demands could not both be met, and the pair squirted out at 959 in/s — six
     * field widths a second. Auto paths went with DECODE (2026-10-12), and nothing kinematic is
     * left, so the guard is a backstop now. It stays dead code, and it should: if it starts
     * binding in ordinary play, something upstream is wrong — which is why the ceiling is an
     * ABSOLUTE speed and not a multiple of this robot's own (see `PHYS_MAX_ROBOT_SPEED`; the
     * per-robot version fired on ordinary shoves of a slow chassis by a fast one).
     */
    /**
     * A CONTACT MAY NOT SLING YOU SIDEWAYS PAST WHAT THE TYRES HOLD — IN THE SAME TICK.
     *
     * The per-wheel traction answers a tick late, which is right for a sustained drag and
     * wrong for an impact: driving into the gate structure at 30 in/s came out at 10.7 in/s
     * pointing somewhere else, and the wheels then spent a tenth of a second clawing the
     * sideways half back. Reported as a surge of strafing speed at the gate, and the old model
     * never showed it because it re-imposed the commanded velocity every tick, so no impact
     * could redirect anybody.
     *
     * ONLY THE SIDEWAYS HALF, and that is the whole point. The normal component still stops
     * you, the ROTATION an off-centre hit produces is untouched — "the turning should honestly
     * happen" — and what goes is the part a real tyre would simply refuse: a wall cannot
     * accelerate a chassis along itself harder than friction allows.
     */
    let vx = v.x;
    let vy = v.y;
    const w = drive?.get(r.id);
    if (w) {
      const rc = dcos(r.heading);
      const rs = dsin(r.heading);
      const latV = -vx * rs + vy * rc; // the solver's sideways velocity, robot-left positive
      const latW = -w.wantX * rs + w.wantY * rc; // ...and the sideways velocity the drive asked for
      /**
       * BEING STOPPED IS NOT BEING SLUNG. The clip exists for a contact that DRAGS the chassis
       * sideways faster than the tyres could ever allow. It used to measure the whole
       * difference between the solver's answer and the drive's request, which also includes a
       * contact that merely REFUSED a sideways request — a mecanum strafing into a wall — and
       * "corrected" that by handing the commanded strafe back: the chassis sat against the
       * wall reporting 34 in/s sideways, the drive fed on that, and every tick the solver had
       * to stop it again from scratch while the penetration ratcheted. So only an EXCESS
       * counts: sideways motion beyond what was asked, in the direction the robot is already
       * going, or a reversal against it. Motion that fell short of the request was stopped
       * by a contact, and a contact is allowed to stop you.
       */
      let over = 0;
      let dir = 0;
      if (latV * latW > 0) {
        if (Math.abs(latV) > Math.abs(latW)) {
          over = Math.abs(latV) - Math.abs(latW) - w.latCap;
          dir = Math.sign(latV);
        }
      } else if (latV !== 0) {
        over = Math.abs(latV) - w.latCap;
        dir = Math.sign(latV);
      }
      if (over > 0) {
        const back = dir * over;
        vx += rs * back;
        vy -= rc * back;
      }
    }
    const speed = hyp(vx, vy);
    const scale = speed > C.PHYS_MAX_ROBOT_SPEED ? C.PHYS_MAX_ROBOT_SPEED / speed : 1;
    r.vel.x = vx * scale;
    r.vel.y = vy * scale;
    /**
     * THE SOLVER OWNS THE HEADING NOW. `updateRobot` used to integrate it, because a
     * rotation-locked body had no rotation to report; the drive arrives as a torque instead
     * and this reads back what the wheels and every contact did between them.
     *
     * The spin guard is the angular twin of `PHYS_MAX_ROBOT_SPEED` and is dead code in
     * ordinary play for the same reason: nothing on this field can legitimately spin a robot
     * past a few times its own top rate, so a larger number is the solver failing an
     * over-constrained contact rather than a hit anybody felt.
     */
    /**
     * The spin the solver worked out, guarded only against its own explosions. The tyres have
     * already had their say — four lateral traction forces went INTO this solve (see the wheel
     * loop in `updateRobot`), so a contact that spun the chassis anyway did it against grip
     * that was resisting at the time, which is the whole point of slice B.
     */
    const av = body.angvel();
    /**
     * ...AND WHAT THE CONTACTS DID, kept for the wheels to resist next tick.
     *
     * The drive asked for `wantX/wantY/wantW`; anything else in the solver's answer arrived
     * through a contact. The per-wheel traction model in `updateRobot` turns this into four
     * lateral forces, each clipped to one tyre's grip — which is why a sustained lean is
     * refused outright and an impact is not.
     */
    r.slipX = w ? vx - w.wantX : 0;
    r.slipY = w ? vy - w.wantY : 0;
    r.slipW = w ? av - w.wantW : 0;
    r.angVel = clamp(av, -C.PHYS_MAX_ROBOT_SPIN, C.PHYS_MAX_ROBOT_SPIN);
    /**
     * THE HEADING IS INTEGRATED FROM THAT, NOT READ OFF THE BODY.
     *
     * `body.rotation()` carries Rapier's positional PENETRATION CORRECTION as well as the
     * motion — a bias applied straight to the pose, with no angular velocity behind it — and
     * that is not a rotation anything did. A robot placed a hair inside the gate stub, idle,
     * with `angvel` reading 0.0000 the whole time, was quietly turned 7.2° by it. The tyres'
     * refusal above governs the rotation, so the heading follows the rotation it governs.
     */
    r.heading = wrapAngle(r.heading + r.angVel * dt);
  }

  rw.free();
  return preVels;
}

/**
 * COLLISION GROUPS. Rapier packs these as `(membership << 16) | filter`, and two colliders
 * interact only if each one's membership is in the other's filter — BOTH directions have to
 * agree, which is why everything here names a membership of its own rather than the default
 * "member of everything".
 *
 * ROBOT solve:
 *  · FOOT — a robot's footprint (chassis + intake reach). Meets the field and other footprints.
 *  · STAT — the field's static colliders (walls, and whatever structures a game declares).
 *    Meet footprints.
 *
 * ARTIFACT solve — every robot is an immovable sweep here, so robot-robot and robot-field pairs
 * never arise; the bits exist to state two exclusions:
 *  · an artifact the INTAKE has hold of (CLAIMED) does not meet the CHASSIS of the claiming
 *    robot, because the funnel is drawing it onto the chassis face and the two would fight
 *    (measured 1.45s to swallow one 7in off-centre against 0.33s). It still meets the intake's
 *    structure, which is what guides it in.
 *  · the artifact a gate is EXPELLING into an occupied mouth (DOOR) does not meet the HELD
 *    artifacts, or a full hopper would plug the outflow for as long as the robot stood there.
 *    It still meets the chassis: excluding that let it travel straight through a robot.
 */
const R_FOOT = 0x0001_0003;
const R_STAT = 0x0002_0001;

const A_LOOSE = 0x0001;
const A_CLAIMED = 0x0002;
const A_CHASSIS = 0x0004;
const A_FIELD = 0x0008;
const A_STRUCT = 0x0010;
const A_HELD = 0x0020;
const A_DOOR = 0x0040;
const A_BALLS = A_LOOSE | A_CLAIMED | A_DOOR;
const groups = (membership: number, filter: number): number => (membership << 16) | filter;

/** a Rapier collider for one artifact-solid shape, in the parent body's frame */
function solidDesc(sh: SolidShape): RAPIER.ColliderDesc | null {
  if (sh.kind === 'box') return RAPIER.ColliderDesc.cuboid(sh.hx, sh.hy).setTranslation(sh.cx, sh.cy);
  if (sh.kind === 'circle') return RAPIER.ColliderDesc.ball(sh.r).setTranslation(sh.cx, sh.cy);
  const flat = new Float32Array(sh.pts.length * 2);
  sh.pts.forEach((p, i) => {
    flat[2 * i] = p.x;
    flat[2 * i + 1] = p.y;
  });
  return RAPIER.ColliderDesc.convexHull(flat);
}

/** where a robot's sweep began this tick, for the artifact solve */
export interface SweepFrom {
  x: number;
  y: number;
  heading: number;
}

/**
 * Resolve GROUND-artifact translation + velocity for one tick: light circle bodies against
 * the static field and against every robot's artifact-solid geometry, with each robot an
 * IMMOVABLE SWEEP from where it began the tick to where the robot solve put it.
 *
 * THE ROBOT IS KINEMATIC HERE, ON PURPOSE, AND THAT IS THE WHOLE DESIGN. Its position was
 * decided by the robot solve, which owns walls, other robots, the gate handle, the perimeter
 * invariant — and any artifact that turned out to be pinned. Nothing in this solve may move it,
 * so there is no second answer to reconcile: an artifact that can get out of the way is pushed
 * out of the way at the robot's own speed, and one that cannot is reported back
 * (`pinnedArtifacts`) so the ROBOT solve can be re-run with it as a wall. Product decision #7
 * ("outflow cannot shove a parked robot") falls out for free: a kinematic body is pushed by
 * nothing.
 *
 * A POSITION-BASED kinematic body, from the START pose to the END pose, rather than a body
 * placed at the end pose. Placed at the end it is already overlapping whatever it drove into,
 * and the only thing acting on that artifact is penetration recovery, which is soft and slow
 * by design — that is where "the balls go on top of the robot" came from. Swept, the contact
 * happens at the surface: Rapier derives the sweep velocity from the two poses, the
 * speculative contact (`PHYS_BALL_PREDICTION`) exists before the pair touch, and the artifact
 * is pushed ahead of the chassis with the chassis's own velocity.
 *
 * This is the ONLY writer of a ground artifact's position. There is no clamp, no relaxation
 * pass, no eviction and no revert after it; the field, the classifier, the goal faces and every
 * robot are colliders in the same solve, so there is nothing left to take turns with.
 */
export function solveArtifacts(
  world: World,
  dt: number,
  colliders: FieldColliders,
  /** artifacts the intake has hold of — allowed onto the claiming chassis's face */
  claimed: ReadonlySet<number>,
  /** the artifact each gate is expelling — allowed past a robot's held artifacts */
  doorway: ReadonlySet<number>,
  solids: ReadonlyMap<number, RobotSolids>,
  from: ReadonlyMap<number, SweepFrom>,
  /**
   * the GROUND-ARTIFACT radius this solve is for, in inches. A parameter rather than
   * `C.BALL_RADIUS` outright because the solve is the shared one and the element is not:
   * BIOBUZZ's POLLEN is 1.5in where DECODE's artifact was 2.5in, and a solve run at the wrong
   * radius separates a pile at the wrong diameter. A caller that passes nothing gets
   * `C.BALL_RADIUS`, DECODE's size, which is what this defaulted to while DECODE was its caller.
   *
   * It must be the SAME radius the caller built `solids` with (`robotSolids`' own trailing
   * argument) — the held-artifact circles are the plug in the robot's own mouth, and two
   * radii in one solve is two descriptions of one element, which is the disagreement
   * `artifactSolids.ts` exists to prevent.
   *
   * ⚠️ IT IS THE FALLBACK, NOT THE SIZE. An artifact that carries its own `r` is solved at
   * that, because a field may hold two sizes at once: BIOBUZZ's POLLEN is 1.4 and its NECTAR
   * 1.8, and one flat number gives whichever is not it a collider that disagrees with the
   * circle the renderer draws.
   */
  radius: number = C.BALL_RADIUS,
): void {
  const groundBalls = world.balls.filter((b) => b.state.kind === 'ground');
  if (groundBalls.length === 0) return;

  const rw = makeWorld(
    dt,
    colliders,
    C.PHYS_BALL_CONTACT_FREQ,
    C.PHYS_BALL_ALLOWED_ERROR,
    groups(A_FIELD, A_BALLS),
    C.PHYS_BALL_WALL_FRICTION,
  );
  rw.integrationParameters.normalizedPredictionDistance = C.PHYS_BALL_PREDICTION;

  const ballBodies: { b: Artifact; body: RAPIER.RigidBody }[] = [];
  for (const b of groundBalls) {
    const body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(b.pos.x, b.pos.y)
        .lockRotations()
        .setLinvel(b.vel.x, b.vel.y),
    );
    const isClaimed = claimed.has(b.id);
    const isDoor = doorway.has(b.id);
    const membership = (isClaimed ? A_CLAIMED : A_LOOSE) | (isDoor ? A_DOOR : 0);
    /**
     * A CLAIMED artifact meets the chassis too. The claim used to drop the chassis from its
     * filter so the intake could have it, but the intake captures it AT the face (`hl + R`,
     * touching), and everything the exclusion actually did was let a pile behind push a claimed
     * artifact through the face and 2.5in into the robot while its capture timer ran —
     * "artifact-chassis overlap still happens". It ignores only the HELD artifacts while it is
     * the doorway's, as before.
     */
    const filter = A_BALLS | A_FIELD | A_STRUCT | A_CHASSIS | (isDoor ? 0 : A_HELD);
    rw.createCollider(
      RAPIER.ColliderDesc.ball(b.r ?? radius)
        .setMass(C.BALL_MASS)
        .setRestitution(C.BALL_BALL_RESTITUTION)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setCollisionGroups(groups(membership, filter))
        .setFriction(C.PHYS_BALL_FRICTION),
      body,
    );
    ballBodies.push({ b, body });
  }

  // ...then the robots, AFTER the artifacts so the artifact collider creation order is
  // untouched (Rapier resolution depends on it, and replays re-sim through this)
  for (const r of world.robots) {
    const f = from.get(r.id) ?? { x: r.pos.x, y: r.pos.y, heading: r.heading };
    const body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(f.x, f.y).setRotation(f.heading),
    );
    // the sweep: Rapier derives the velocity from these two poses. The rotation is handed
    // over as the SHORTEST turn from the start heading, or a wrap at ±π reads as a full spin.
    body.setNextKinematicTranslation({ x: r.pos.x, y: r.pos.y });
    body.setNextKinematicRotation(f.heading + wrapAngle(r.heading - f.heading));
    const sol = solids.get(r.id);
    if (!sol) continue;
    const add = (sh: SolidShape, membership: number, filter: number, friction: number) => {
      const d = solidDesc(sh);
      if (!d) return;
      rw.createCollider(
        d.setRestitution(C.BALL_ROBOT_RESTITUTION)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setFriction(friction)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setCollisionGroups(groups(membership, filter)),
        body,
      );
    };
    // ...and the chassis lists CLAIMED artifacts too, or the pair never collides: a Rapier pair
    // needs each side's membership in the other's filter
    add(sol.chassis, A_CHASSIS, A_LOOSE | A_CLAIMED | A_DOOR, C.PHYS_BALL_FRICTION);
    // the intake's slopes and rails GUIDE an artifact toward the throat; the rollers are
    // compliant wheels, not a brake, so what slides along them is barely held back
    for (const sh of sol.structure) add(sh, A_STRUCT, A_BALLS, C.INTAKE_STRUCT_FRICTION);
    for (const sh of sol.held) add(sh, A_HELD, A_LOOSE | A_CLAIMED, C.INTAKE_STRUCT_FRICTION);
  }

  rw.step();

  for (const { b, body } of ballBodies) {
    const p = body.translation();
    const v = body.linvel();
    b.pos.x = p.x;
    b.pos.y = p.y;
    // capped: a squeeze between a chassis and a wall can hand a ball any speed the constraints
    // demand (a wedge a few degrees open asks for many times the robot's own advance), and a
    // ball moving more than the look-ahead in a tick is one the next tick cannot see coming —
    // a 5in artifact went through a 2.7in corner gap that way. An artifact popping out of a
    // squeeze does not exceed this in reality either.
    const speed = hyp(v.x, v.y);
    const k = speed > C.BALL_MAX_SPEED ? C.BALL_MAX_SPEED / speed : 1;
    b.vel.x = v.x * k;
    b.vel.y = v.y * k;
  }

  rw.free();
}
