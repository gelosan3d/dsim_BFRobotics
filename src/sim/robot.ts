import type { RobotCommand, RobotSpec, RobotState, World } from '../types';
import * as C from '../config';
import { rot, wrapAngle, hyp, dsin, dcos, datan2, clamp } from '../math';
import { viewAngleOf } from './field';
import { activeDrive, driveParams, motorStep, motorStepVec, shoveMass } from './drivetrain';

/**
 * Updates the robot's drive physics (position, velocity, angular velocity, heading).
 * This function is for movement only.
 */
/** what the drivetrain asks the solver for this tick: a world-frame force and a torque
 *  about the chassis centre. See the note at the bottom of `updateRobot`. */
export interface DriveWrench {
  fx: number;
  fy: number;
  tau: number;
  /** the velocity and spin the motor model asked for. `solveRobots` diffs its own answer
   *  against these to record what the CONTACTS did — see `RobotState.slipX`. */
  wantX: number;
  wantY: number;
  wantW: number;
  /** how much SIDEWAYS velocity a contact may impart in one tick before the tyres refuse it:
   *  `LATERAL_GRIP` times this drivetrain's traction ceiling. See `solveRobots`. */
  latCap: number;
}

/**
 * A DEBOUNCED PRESS EDGE for a toggle button (butterfly `driveMode`, the BIOBUZZ ramp).
 *
 * A release shorter than `TOGGLE_DEBOUNCE_S` is a dropout, not a release: replay 1dc6eb8f
 * (2026-09-25) held a toggle through a one-tick all-zero input frame and a one-tick bit drop, and
 * each flipped the toggle twice. `upAt` is when the button went up while `held` is still latched.
 * Returns the new latch state and whether this tick is a fresh press.
 */
export function debouncedPress(
  held: boolean,
  upAt: number | undefined,
  wants: boolean,
  time: number,
): { press: boolean; held: boolean; upAt: number | undefined } {
  if (!wants) {
    if (!held) return { press: false, held: false, upAt: undefined };
    if (upAt === undefined) return { press: false, held: true, upAt: time };
    if (time - upAt >= C.TOGGLE_DEBOUNCE_S) return { press: false, held: false, upAt: undefined };
    return { press: false, held: true, upAt };
  }
  const released = upAt !== undefined && time - upAt >= C.TOGGLE_DEBOUNCE_S;
  return { press: !held || released, held: true, upAt: undefined };
}

export function updateRobot(
  world: World,
  r: RobotState,
  cmd: RobotCommand,
  dt: number,
): DriveWrench {
  // ---- BUTTERFLY: drop the other wheel set (edge-triggered, so holding swaps once) ----
  // Lives here rather than in either game's step because it is a DRIVETRAIN behaviour and
  // both games route their drive through updateRobot. The swap is instantaneous in the
  // model: the real lift takes a moment, but at 60 Hz that is a couple of ticks and the
  // interesting decision is WHEN to swap, not the servo travel.
  if (r.spec.drivetrain === 'butterfly') {
    const e = debouncedPress(r.driveModeHeld, r.driveModeUpAt, cmd.driveMode ?? false, world.time);
    if (e.press) r.butterflyTank = !r.butterflyTank;
    r.driveModeHeld = e.held;
    if (e.upAt !== undefined || r.driveModeUpAt !== undefined) r.driveModeUpAt = e.upAt;
  }
  // ---- drive: driver frame -> robot frame -------------------------------
  const dp = driveParams(r.spec, r.butterflyTank);
  // ---- power draw: a spun-up flywheel (inertia × spin, set last tick in
  // updateRobotActions) plus a running intake pull current off the drive
  // motors — slow the LOCAL dp copy (driveParams() itself is untouched so the
  // 75/7/280 calibration holds) and record it for the Rapier shove.
  const intakeDraw =
    (cmd.intake || r.autoIntake) && r.hopper.length < C.HOPPER_CAPACITY;
  // flywheel: a small steady HOLD cost (being far barely matters) plus the
  // DOMINANT SPIN-UP cost of accelerating the wheel while driving away from the
  // goal — both scale with the wheel's inertia (heavy = expensive to spin up).
  const flywheelDraw =
    r.spec.flywheelInertia *
    (C.POWER_DRAW_FLYWHEEL_HOLD * r.flywheelSpin +
      C.POWER_DRAW_FLYWHEEL_SPINUP * r.flywheelSpinRate);
  // swerve: the four steering (pivot) motors pull steady current just to hold +
  // correct the pod angles, on top of the drive motors — always a bit slower.
  const swerveDraw = dp.saturation === 'vec' ? C.POWER_DRAW_SWERVE : 0;
  // drive current rises with RPM: a drivetrain geared for more speed pulls more
  // current from the pack (only above the reference rpm, so base calibration holds)
  // → diminishing top-speed returns on cranking rpm + more sag under load.
  const driveDraw =
    C.POWER_DRAW_DRIVE *
    clamp(
      // the rpm ACTUALLY turning the wheels — a butterfly in tank mode draws on its
      // traction gearing, not the mecanum slider it isn't using
      (activeDrive(r.spec, r.butterflyTank).rpm - C.REF_DRIVE_RPM) /
        (C.POWER_DRAW_DRIVE_TOP_RPM - C.REF_DRIVE_RPM),
      0,
      1,
    );
  const draw = Math.min(
    flywheelDraw + (intakeDraw ? C.POWER_DRAW_INTAKE : 0) + swerveDraw + driveDraw,
    C.POWER_DRAW_MAX,
  );
  r.powerDraw = draw;
  const slow = 1 - draw;
  /**
   * ...BUT NOT THE TYRES. Power draw is current the flywheel and intake are taking away from
   * the drive MOTORS, and the traction model below is `LATERAL_GRIP` times this drivetrain's
   * traction ceiling — which is mu*g, a property of rubber and weight. A spun-up flywheel does
   * not make the wheels slippery.
   *
   * Taken from the scaled copy it did exactly that, and worst on the builds that carry the
   * most flywheel: the reported gate surge came from a mecanum at `flywheelInertia` 1, whose
   * tyres were reclaiming a contact's sideways shove at two thirds of the rate they should.
   */
  const tractionAccel = dp.accel;
  dp.maxSpeed *= slow;
  dp.accel *= slow;
  dp.maxTurn *= slow;
  dp.turnAccel *= slow;
  const viewAngle = viewAngleOf(r.alliance);
  // driver stick vector: +y = away from driver (screen up), +x = driver right.
  // screen -> world undoes the camera rotation
  const stick = { x: cmd.driveX, y: cmd.driveY };
  let robotVec: { x: number; y: number };
  if (r.fieldCentric) {
    const fieldVec = rot(stick, -viewAngle);
    robotVec = rot(fieldVec, -r.heading);
  } else {
    // robot-centric: stick up = robot forward (+x robot), stick right = strafe right (-y robot)
    robotVec = { x: stick.y, y: -stick.x };
  }
  if (dp.strafeMult === 0) robotVec.y = 0; // tank: strafe input is dead
  // wheel power budget: combined demands share the same wheels, and the
  // shape of the budget depends on the drivetrain (see DRIVETRAIN_PRESETS)
  let targetFwd = 0;
  let targetStrafe = 0;
  let targetOmega = 0;

  if (dp.saturation === 'tank') {
    // Tank drive is always commanded as independent side-drive (leftDrive/rightDrive).
    // The control-STYLE preference (Traditional separate-sticks vs Normal arcade) is a
    // per-driver INPUT concern resolved in GameController, so the sim stays pure and
    // the choice applies the same in solo and multiplayer.
    const ld = cmd.leftDrive ?? 0;
    const rd = cmd.rightDrive ?? 0;
    targetFwd = ((ld + rd) / 2) * dp.maxSpeed;
    targetOmega = (rd - ld) * (dp.maxTurn / 2);
    targetStrafe = 0;
  } else {
    const demand =
      dp.saturation === 'vec'
        ? hyp(robotVec.x, robotVec.y) + Math.abs(cmd.rotate)
        : Math.abs(robotVec.x) + Math.abs(robotVec.y) + Math.abs(cmd.rotate);
    const div = Math.max(1, demand);
    targetFwd = (robotVec.x / div) * dp.maxSpeed;
    targetStrafe = (robotVec.y / div) * dp.maxSpeed * dp.strafeMult;
    targetOmega = (cmd.rotate / div) * dp.maxTurn;
  }

  // SWERVE: modeled as FOUR independent steered modules at the wheel corners.
  // Inverse kinematics gives each pod its own target (velocity = translation +
  // ω×r), it steers there with MODULE OPTIMIZATION (pod flip: a >90° change aims
  // the pod opposite + reverses drive, so it never rotates >90° and a 180° reversal
  // is instant), and — crucially — each pod's control loop is IMPERFECT, adding a
  // small INDEPENDENT oscillating error it can't null out. Because the four errors
  // don't cancel, the FORWARD kinematics of the mis-pointed pods yields real drift
  // AND a net yaw wobble when driving straight. `moduleAngles` are the actual pod
  // directions (also rendered).
  if (dp.saturation === 'vec') {
    const cvx = targetFwd; // commanded chassis velocity (robot frame) + rotation
    const cvy = targetStrafe;
    const cw = targetOmega;
    const hx = Math.max(r.spec.length / 2 - C.WHEEL_INSET, 1);
    const hy = Math.max(r.spec.width / 2 - C.WHEEL_INSET, 1);
    const pos: [number, number][] = [
      [hx, hy],
      [hx, -hy],
      [-hx, hy],
      [-hx, -hy],
    ]; // FL, FR, BL, BR — matches drawRobot's wheel order
    const maxStep = C.MODULE_SLEW_RATE * dt;
    const speedFrac = clamp(hyp(r.vel.x, r.vel.y) / dp.maxSpeed, 0, 1);
    let sumX = 0;
    let sumY = 0;
    let sumT = 0;
    for (let i = 0; i < 4; i++) {
      // inverse kinematics: this module's desired velocity vector
      const dvx = cvx - cw * pos[i][1];
      const dvy = cvy + cw * pos[i][0];
      const spd = hyp(dvx, dvy);
      let driveSpd = 0;
      if (spd > 0.02 * dp.maxSpeed) {
        // there IS a command → set this module's TARGET from it (with pod flip)
        driveSpd = spd;
        let tgt = datan2(dvy, dvx);
        if (Math.abs(wrapAngle(tgt - r.moduleAngles[i])) > Math.PI / 2) {
          tgt = wrapAngle(tgt + Math.PI); // pod flip + reverse this module
          driveSpd = -spd;
        }
        r.moduleTargets[i] = tgt;
      }
      // else: HOLD the last commanded target (r.moduleTargets[i]) — the pods keep
      // slewing to the direction you set even after you let go of the stick, so a
      // brief tap still finishes the turn (they don't freeze partway or snap forward).
      const target = r.moduleTargets[i];
      // the steering loop runs EVERY tick (control loops are always applied): it
      // chases a DISTURBED setpoint (target + an independent, speed-scaled error it
      // can't null). One imperfect loop, two visible symptoms: FAST hunt (the buzz you
      // see) rides on a slowly-varying steady-state MISPOINT the loop can't trim. The
      // slow mispoint is what actually carries the robot off line (fast zero-mean hunt
      // integrates to nothing) — but it is DETUNED per pod (each its own slow rate), so
      // the four biases beat in and out of phase and the net offset MEANDERS/REVERSES
      // across a drive instead of a clean constant crab. Same wobble, emergent drift.
      // ∝ actual speed → at rest it's zero and every pod shares `target` → CONVERGE.
      const t = world.time;
      const f = C.SWERVE_WOBBLE_FREQ;
      const ph = i * 1.87 + r.id * 0.7;
      // per-pod detune of the SLOW mispoint — a wide spread so the 4 de-cohere within
      // one wall-to-wall drive (→ the drift direction rotates as you cross the field)
      const drift = C.SWERVE_DRIFT_FREQ * (1 + i * 0.19 + r.id * 0.05);
      const noise =
        0.34 * dsin(t * f * (1 + i * 0.11) + ph) + // fast visible hunt
        0.2 * dsin(t * f * 2.17 + ph * 1.7 + 1.3) + // fast visible hunt
        0.5 * dsin(t * drift + ph * 2.3); // slow steady-state MISPOINT (detuned) → the drift
      const err = C.SWERVE_WOBBLE_AMP * speedFrac * noise;
      const setpoint = wrapAngle(target + err);
      let d = wrapAngle(setpoint - r.moduleAngles[i]);
      if (Math.abs(d) > maxStep) d = Math.sign(d) * maxStep;
      r.moduleAngles[i] = wrapAngle(r.moduleAngles[i] + d);
      // this module actually pushes at driveSpd along its (mis-pointed) direction
      const fx = driveSpd * dcos(r.moduleAngles[i]);
      const fy = driveSpd * dsin(r.moduleAngles[i]);
      sumX += fx;
      sumY += fy;
      sumT += pos[i][0] * fy - pos[i][1] * fx; // moment about center
    }
    // forward kinematics of the four modules → the ACHIEVED chassis motion (equals
    // the command when perfect; the pod errors make it drift + yaw)
    targetFwd = sumX / 4;
    targetStrafe = sumY / 4;
    targetOmega = sumT / (4 * (hx * hx + hy * hy));
  }

  // motor torque–speed integration in the robot frame: accel falls off toward the
  // free speed (dp.maxSpeed / dp.maxTurn) like a real DC motor (see motorStep).
  const velRobot = rot(r.vel, -r.heading);
  /**
   * BEING SHOVED IS NOT THE SAME AS STOPPING YOURSELF.
   *
   * A robot commanding nothing while an opponent is leaning on it is not braking, it is being
   * back-driven: the wheels roll and what resists is back-EMF plus rolling drag, not the full
   * 1.4x stopping authority `MOTOR_BRAKE_MULT` gives a driver hauling their own momentum down.
   * Applied to the shove, that number said an idle chassis resists harder than any opponent
   * can drive, and pushing one was nearly impossible (see `MOTOR_SHOVE_BRAKE`).
   *
   * The contact test reads LAST tick's `rrContacts` — this runs before the solve that records
   * them, and `world.ts` clears them just before that solve for exactly this reason. One tick
   * of latency on "am I being leaned on" is nothing next to the 0.2s a push takes to build.
   */
  const unpowered = targetFwd === 0 && targetStrafe === 0;
  const shoved =
    unpowered && world.rrContacts.some((c) => c.a === r.id || c.b === r.id);
  // translation steps as a VECTOR so the accel budget is isotropic — driving diagonally
  // accelerates at the same rate as straight (no √2 diagonal-speed advantage).
  const stepped = motorStepVec(
    velRobot.x,
    velRobot.y,
    targetFwd,
    targetStrafe,
    dp.accel,
    dp.maxSpeed,
    dt,
    shoved ? C.MOTOR_SHOVE_BRAKE : C.MOTOR_BRAKE_MULT,
  );
  /**
   * ...AND THE WHEELS HAND THE SOLVER A FORCE, NOT A VELOCITY.
   *
   * This is the whole of slice A. The motor model is UNCHANGED — `motorStepVec` above still
   * decides the velocity the drivetrain wants this tick, from the same torque–speed curve and
   * the same traction-limited `dp.accel` — but that answer is now converted into the force
   * that would produce it (`F = m·Δv/dt`) and handed to Rapier, instead of being written
   * straight onto `r.vel` behind the solver's back.
   *
   * In FREE SPACE the two are identical: `a = F/m` is the accel the motor model asked for, so
   * top speed, the accel curve, the turn rate and stopping distance do not move (the balance
   * contract). In CONTACT they are completely different, and that is the point — a velocity
   * that is imposed forces the solver to invent whatever normal impulse it takes to satisfy
   * it, so friction (µ·N) was a fraction of an unbounded number and a bumper gripped like a
   * clamp. A force is a force: the contact can only ever resolve what the wheels actually
   * supply, and a pushing contest settles at the ratio of the two `pushForce`s by itself.
   *
   * `shoveMass` STAYS the mass, and staying is what keeps the balance intact — it is defined
   * as `pushForce / accel`, so `m·a_cmd` in free space reproduces the old accel exactly while
   * the sustained force at the stops is exactly `pushForce`. See drivetrain.ts; the note there
   * about the sim "pushing by SETTING VELOCITY" is what this replaces.
   */
  const wantRobot = { x: stepped.x - velRobot.x, y: stepped.y - velRobot.y };
  const want = rot(wantRobot, r.heading);
  const m = shoveMass(r.spec, r.butterflyTank, r.powerDraw);
  let fx = (m * want.x) / dt;
  let fy = (m * want.y) / dt;

  /**
   * The turn, as a TORQUE about the chassis centre. Same `motorStep` the heading integration
   * used to consume; `solveRobots` gives the body the matching inertia, so in free space the
   * resulting dω is exactly the one the motor model asked for.
   *
   * ...AND THE TYRES REFUSE A SPIN THEY ARE NOT MAKING, which is the angular twin of the
   * cornering force below and the thing a rotation-locked body never needed. Being spun by a
   * contact is resisted by the wheels' LATERAL grip at their moment arm, not by the drive
   * motors' torque — that is the whole difference between treads and rollers, and without it
   * a tank leaning on a robot strafing out from under it was yawed 17.7° by the friction and
   * then drove off along its own new heading. `LATERAL_GRIP` is already that quantity (the
   * drivetrain's sideways traction as a fraction of its drive ceiling), so this introduces no
   * new dial: four wheels at the half-diagonal can refuse `grip · accel · m · d` of torque,
   * against the motors' `I · turnAccel`, and whichever is larger is what the chassis has.
   *
   * IT ONLY EVER BRAKES, and only while ROBOT-ROBOT CONTACT is on the books — so free-space
   * driving is untouched to the digit (the balance contract) and a commanded turn is never
   * slowed, since `motorStep` reads the boost only on the braking branch and `approach` still
   * stops dead at the target. Same gate, and same reasoning, as `MOTOR_SHOVE_BRAKE`.
   */
  const inertia = chassisInertia(m, r.spec);
  /**
   * ...AND THE SAME SHOVE BRAKE THE TRANSLATION GETS. A robot commanding no turn that is being
   * SPUN by an opponent's off-centre hit used to brake that spin at the full `MOTOR_BRAKE_MULT`,
   * which is the motors actively fighting it — 53 rad/s² on the default chassis, enough to kill
   * any hit's yaw within two ticks. Measured, a 12in-off-centre ram turned its victim 6.5° where
   * the same contact with the motors merely holding turned it 16.5°. The comment above this
   * line has always said the yaw is refused by the tyres' grip and not by the motors' torque,
   * and the translation half already reads `MOTOR_SHOVE_BRAKE` for exactly this case.
   */
  const shovedYaw = targetOmega === 0 && world.rrContacts.some((c) => c.a === r.id || c.b === r.id);
  const wNext = motorStep(
    r.angVel,
    targetOmega,
    dp.turnAccel,
    dp.maxTurn,
    dt,
    shovedYaw ? C.MOTOR_SHOVE_BRAKE : C.MOTOR_BRAKE_MULT,
  );
  let tau = (inertia * (wNext - r.angVel)) / dt;

  /**
   * ...AND THE TYRES ARE FOUR WHEELS, EACH WITH ITS OWN GRIP — slice B.
   *
   * A wheel makes force in two ways and they are not the same thing. Along its roll axis the
   * motor drives it, and that is the chassis-level model above, unchanged. ACROSS that axis it
   * makes no force of its own at all: it either grips and the chassis goes where the wheels
   * point, or it breaks traction and scrubs. That second half is what a chassis-level model
   * cannot express, and it is the whole of robot-on-robot feel — treads refusing to be dragged
   * sideways or spun, rollers giving way.
   *
   * SLICE A APPROXIMATED IT AFTER THE FACT: `solveRobots` compared the solver's answer against
   * what the drive asked for and trimmed the difference (`holdLat`/`yawHold`), Coulomb-style.
   * That works for a steady lean and fails for an impact, because trimming happens AFTER the
   * solve and cannot tell a 40 in/s hit from a 2 in/s drag except by magnitude — so a scale
   * factor (`CONTACT_YAW_HOLD`) had to split the difference, and near-centred rams stopped
   * spinning anybody.
   *
   * Now it is a FORCE, computed per wheel and handed to the solver, which resolves it
   * SIMULTANEOUSLY with the contact. The discrimination falls out for free: a lean asks for
   * less than the tyre can supply and is refused outright, while an impact asks for more than
   * `LATERAL_GRIP · accel / 4` and the excess goes through as real motion. Nothing decides
   * which case it is — the traction limit does.
   *
   * PER WHEEL AND NOT PER CHASSIS, because that is what produces the yaw. Four lateral forces
   * at their own moment arms resist a spin exactly as far as their grip allows, so the same
   * expression that stops a tank being dragged sideways stops it being twisted, and neither
   * needs a term of its own.
   *
   * THE SLIP IS MEASURED AGAINST THE COMMANDED MOTION, not against zero — that is what keeps
   * this out of the balance. A robot turning at the rate it asked for is scrubbing its wheels
   * exactly as much as the drive model already accounts for, so the deviation is zero and
   * nothing is applied; in free space the term does not exist. What it sees is the difference
   * between where the chassis is going and where the wheels are pointed, which only a contact
   * (or a wall) can produce.
   *
   * SWERVE READS ITS PODS. `moduleAngles` is where each wheel is actually pointed, wobble and
   * all, so a mis-steered pod resists along the wrong axis by itself.
   */
  const grip = C.LATERAL_GRIP[r.spec.drivetrain] ?? 0.5;
  /**
   * ...AND THE SAME WHEELS CARRY THE VELOCITY ROUND A CORNER.
   *
   * Turning while moving needs a lateral force of `m·v·ω` — that is what holds the velocity's
   * angle to the chassis while the nose comes round. Without it the world-frame velocity simply
   * stays where it was and every drivetrain side-slips through every corner, which is "I drive
   * straight and turn with tank and feel shifted sideways in a weird way".
   *
   * IT IS THE CENTRIPETAL DEMAND, NOT A CORRECTION OF THE ERROR AFTERWARDS. Correcting the
   * lateral velocity once it has appeared is a first-order lag and leaves a permanent residual:
   * measured, a tank through the smoke suite's own turn carried 3.0% of its velocity sideways
   * that way, against 0.4% here and a 1.0% ceiling. The tyres do this BEFORE the slip exists,
   * which is exactly what the old velocity-carve was doing when it rotated `r.vel` by the
   * heading change — the same quantity, stated as the force it always was.
   *
   * The cap is unchanged: `LATERAL_GRIP` as a fraction of the drivetrain's own traction
   * ceiling. Past what the tyres can supply — fast enough, turning hard enough — the robot
   * slides through the corner exactly as it did before, and it slides sooner on omnis than on
   * treads.
   */
  const speed = hyp(r.vel.x, r.vel.y);
  if (speed > 0.01 && r.angVel !== 0) {
    const a = Math.min(speed * Math.abs(r.angVel), grip * tractionAccel);
    const sgn = Math.sign(r.angVel);
    fx += (m * a * -r.vel.y * sgn) / speed;
    fy += (m * a * r.vel.x * sgn) / speed;
  }
  const wheels = wheelLocals(r.spec);
  // the budget ONE wheel has across its roll axis, as a force
  const wheelCap = (grip * tractionAccel * m) / wheels.length;
  const swerve = dp.saturation === 'vec';
  // the chassis slip a contact left last tick, in the ROBOT frame (see RobotState.slipX)
  const slipW = r.slipW ?? 0;
  const sl = rot({ x: r.slipX ?? 0, y: r.slipY ?? 0 }, -r.heading);
  if (sl.x !== 0 || sl.y !== 0 || slipW !== 0) {
    for (let i = 0; i < wheels.length; i++) {
      const wl = wheels[i];
      // how fast THIS wheel is being dragged across itself, rotation included
      const sx = sl.x - slipW * wl.y;
      const sy = sl.y + slipW * wl.x;
      // ...across the axis it rolls on. A pod steers; everything else is chassis-aligned.
      const ang = swerve ? (r.moduleAngles?.[i] ?? 0) : 0;
      const lx = -dsin(ang);
      const ly = dcos(ang);
      const slip = sx * lx + sy * ly;
      if (slip === 0) continue;
      /**
       * A TYRE OPPOSES MOTION. IT NEVER CREATES IT.
       *
       * `slip` is the difference between what the solver did and what the wrench asked for,
       * which reads both ways: a contact that DRAGS the chassis sideways shows up with one
       * sign and is correctly refused, and a contact that BLOCKS it shows up with the other —
       * at which point nulling the difference means shoving the chassis in the direction the
       * wall just prevented. Reported from a match file as a surge of strafing speed while
       * barely moving and already against the gate: measured at three separate moments in that
       * run, a robot at a DEAD STOP with no rotation and nothing else touching it accelerated
       * sideways from 0.0 to 6.6 to 10.9 in/s, roughly 400 in/s^2, which is more than its
       * drivetrain can produce in the first place.
       *
       * So the force is admitted only when it opposes how this wheel is ACTUALLY sliding
       * across itself. Nothing else about the model changes: a drag is still refused up to
       * grip, an impact still gets through, and a blocked robot simply stays blocked.
       */
      const across = (velRobot.x - r.angVel * wl.y) * lx + (velRobot.y + r.angVel * wl.x) * ly;
      if (slip * across <= 0) continue;
      // the force that would null it this tick, and what this one tyre can actually hold
      // EXACTLY what was seen, no more. The tyres answer a tick late, so answering HARDER to
      // close that gap is tempting and it oscillates: at a gain of 1.5 an 8in off-centre ram
      // came out at 0.34 degrees against 11.7 at unity, because the over-correction cancels
      // the spin it is chasing. Unity is the only stable answer.
      const want = (-slip * m) / wheels.length / dt;
      const f = clamp(want, -wheelCap, wheelCap);
      const world = rot({ x: f * lx, y: f * ly }, r.heading);
      fx += world.x;
      fy += world.y;
      tau += wl.x * f * ly - wl.y * f * lx;
    }
  }
  /**
   * WHAT THIS WRENCH ITSELF WILL PRODUCE, in free space — the whole of it, traction included,
   * not just the motor's target. `solveRobots` diffs the solver's answer against these to find
   * what the CONTACTS did, so anything we apply on purpose has to be in here or the model
   * reads its own work as fresh slip and fights it: measured, that was a ±2.07 in/s limit
   * cycle running forever with nothing touching the robot.
   */
  return {
    fx,
    fy,
    tau,
    wantX: r.vel.x + (fx / m) * dt,
    wantY: r.vel.y + (fy / m) * dt,
    wantW: r.angVel + (tau / inertia) * dt,
    latCap: grip * tractionAccel * dt,
  };
}

/**
 * The chassis's angular inertia about its own centre, for `m` = `shoveMass`.
 *
 * A rectangle's `m(L² + W²)/12`, over the CHASSIS rather than the footprint, and about the
 * chassis centre rather than the footprint's — the same expression `squareUpPair`'s two-body
 * impulse already used, so the two agree about how hard this robot is to spin, and the drive
 * model's `maxTurn` (derived from the half-diagonal about that centre) stays the free-space
 * answer. `solveRobots` states the same mass properties on the body.
 */
/**
 * The four wheel ground-contact points in the ROBOT frame — the same layout `wheelContacts`
 * puts in world space for BASE parking, kept here as locals because the traction model needs
 * the moment arms rather than the world positions. FL/FR/BR/BL, matching `moduleAngles`.
 */
export function wheelLocals(spec: RobotSpec): { x: number; y: number }[] {
  const ix = Math.max(spec.length / 2 - C.WHEEL_INSET, 1);
  const iy = Math.max(spec.width / 2 - C.WHEEL_INSET, 1);
  return [
    { x: ix, y: iy },
    { x: ix, y: -iy },
    { x: -ix, y: -iy },
    { x: -ix, y: iy },
  ];
}

export function chassisInertia(m: number, spec: RobotSpec): number {
  return (m * (spec.length * spec.length + spec.width * spec.width)) / 12;
}