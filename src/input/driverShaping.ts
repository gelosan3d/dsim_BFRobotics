/**
 * ONE DRIVER'S STICK, SHAPED INTO THE COMMAND THEIR ROBOT RECEIVES — every input-level behaviour
 * that sits between `InputManager.poll()` and the sim: the drive-style switch, flip front, park
 * mode, and the FTC25 controls' slow mode, shooter preset and target snap.
 *
 * It used to be written straight into `GameController.frameLogic` against the controller's own
 * fields. It is a class now because a Local versus has TWO people driving on one device, each
 * with their own flip, park, preset and snap in progress — the same rules, two copies of the
 * state. DOM-free and clock-free, so `npm test` drives it.
 *
 * Nothing here touches the robot: every behaviour is a rewrite of the COMMAND, so a run is still
 * reproduced by `{seed, setups, commands}` and nothing on the wire or the server changes. That is
 * the `driveFrame` contract (`src/input/driveFrame.ts`), kept for all of them.
 */
import type { RobotCommand, RobotState } from '../types';
import { clamp, wrapAngle } from '../math';
import { FTC25_SLOW_FACTOR, FTC25_SNAP } from './bindings';
import { reframeStick } from './driveFrame';

/** the per-frame edges and levels one driver's input produced (`InputManager`'s fields) */
export interface ShapingInput {
  driveFramePressed: boolean;
  flipPressed: boolean;
  parkPressed: boolean;
  slowHeld: boolean;
  snapAimPressed: boolean;
  snapAltPressed: boolean;
  powerPicked: number;
}

export interface ShapingCtx {
  /** the driver station's frame for this robot's alliance (`viewAngleOf`) */
  viewAngle: number;
  parkSpeedPct: number;
  tankControlMode: 'normal' | 'traditional';
  /** may park mode be turned ON now (the robot can drive) */
  canPark: boolean;
  /**
   * MAY THE FTC25 EXTRAS ACT — slow mode, the presets, the element buttons, the snap? Everywhere
   * this device or a LAN room runs the match; NOT in a room on DSIM's own servers (owner,
   * 2026-10-12: nothing of this fork may reach them). There the FTC25 layout still drives,
   * intakes and shoots, and its own buttons do nothing.
   */
  forkFeatures: boolean;
  /** the heading the robot must hold to face the season's target (`GameSimModule.aimHeading`),
   *  `alt` for the other one, or null when the game has none */
  aimHeading: (alt: boolean) => number | null;
  /** seconds since the last frame, for the snap's give-up clock */
  dt: number;
}

/**
 * ONE FRAME OF A TARGET SNAP: the turn command, or null when the snap is over. Half power far
 * out, tapering toward the target from `slowFrom` so the chassis does not swing past it, never
 * below `minPower` (the drivetrain's own deadband would stall it short). Over inside `tolerance`,
 * the moment the driver's own stick passes `cancel`, or after `giveUpS`.
 */
export function ftc25SnapTurn(err: number, stickIn: number, elapsed: number, cfg: typeof FTC25_SNAP = FTC25_SNAP): number | null {
  if (stickIn > cfg.cancel || Math.abs(err) <= cfg.tolerance || elapsed > cfg.giveUpS) return null;
  const mag = Math.max(cfg.minPower, cfg.power * Math.min(1, Math.abs(err) / cfg.slowFrom));
  return Math.sign(err) * mag;
}

export class DriverShaping {
  /** drive controls reversed so the shooter side leads (robot-centric only) */
  frontFlipped = false;
  /** the mid-match drive style (`driveFrame`): null = the robot's spawn style */
  fieldCentricLive: boolean | null = null;
  /** park mode: caps drive command magnitude to `parkSpeedPct` while on */
  parked = false;
  /** the FTC25 shooter preset (`RobotCommand.shotPower`), 0 = preset 1, the one a robot powers up on */
  shotPowerIdx = 0;
  /** a target snap in progress: which target, and how long it has run */
  snap: { alt: boolean; t: number } | null = null;

  /** every run starts in the menu's style, unflipped, unparked, on preset 1, not snapping */
  reset(): void {
    this.frontFlipped = false;
    this.fieldCentricLive = null;
    this.parked = false;
    this.shotPowerIdx = 0;
    this.snap = null;
  }

  /** the drive style this robot is driven in now: the driver's switch, else its spawn style */
  liveFieldCentric(r: RobotState): boolean {
    return this.fieldCentricLive ?? r.fieldCentric;
  }

  /** rewrite `cmd` (in place, and returned) for robot `r` */
  apply(cmd: RobotCommand, input: ShapingInput, r: RobotState, ctx: ShapingCtx): RobotCommand {
    // A BUTTERFLY with its traction set down drives as a tank, and the sim's tank branch reads
    // only leftDrive/rightDrive — no drive style reaches it.
    const drivingTank = r.spec.drivetrain === 'tank' || (r.spec.drivetrain === 'butterfly' && r.butterflyTank);
    // drive style switch: field-centric ⇄ robot-centric for the rest of this run. A pure tank
    // has no strafe to re-aim, so the press does nothing there rather than light a HUD item
    // that changes nothing.
    if (input.driveFramePressed && r.spec.drivetrain !== 'tank') {
      const next = !this.liveFieldCentric(r);
      this.fieldCentricLive = next === r.fieldCentric ? null : next;
    }
    const fieldCentric = this.liveFieldCentric(r);
    // the stick as the driver gave it, before anything below rescales it — what cancels a snap
    const stickIn = Math.abs(cmd.driveX) + Math.abs(cmd.driveY) + Math.abs(cmd.rotate);
    // "flip front": reverse robot-centric drive so the shooter side leads.
    // Meaningless in field-centric (translation is driver-frame there).
    if (!fieldCentric) {
      if (input.flipPressed) this.frontFlipped = !this.frontFlipped;
      if (this.frontFlipped) {
        cmd.driveX = -cmd.driveX;
        cmd.driveY = -cmd.driveY;
      }
    }
    // the switched style, re-expressed in the frame the robot reads (`reframeStick`)
    if (fieldCentric !== r.fieldCentric && !drivingTank) {
      const s = reframeStick({ x: cmd.driveX, y: cmd.driveY }, fieldCentric, r.heading, ctx.viewAngle);
      cmd.driveX = s.x;
      cmd.driveY = s.y;
    }
    // park mode: toggle on press. Turning it ON is gated to when the robot can drive; turning it
    // back OFF is always allowed. While on, cap the drive command for precision control.
    if (input.parkPressed) {
      if (this.parked) this.parked = false;
      else if (ctx.canPark) this.parked = true;
    }
    if (this.parked) {
      const k = Math.max(0, Math.min(100, ctx.parkSpeedPct)) / 100;
      cmd.driveX *= k;
      cmd.driveY *= k;
      cmd.rotate *= k;
    }
    if (ctx.forkFeatures) {
      // FTC25 slow mode: while held, the stick at `FTC25_SLOW_FACTOR` (their RT), on top of park
      if (input.slowHeld) {
        cmd.driveX *= FTC25_SLOW_FACTOR;
        cmd.driveY *= FTC25_SLOW_FACTOR;
        cmd.rotate *= FTC25_SLOW_FACTOR;
      }
      // FTC25 shooter preset: the last d-pad pick, sent as a LEVEL every tick. Left off the
      // command at preset 1, so a DSim-controls command is the object it always was.
      if (input.powerPicked >= 0) this.shotPowerIdx = input.powerPicked;
      if (this.shotPowerIdx !== 0) cmd.shotPower = this.shotPowerIdx;
    } else {
      // a room on DSIM's servers sees an ordinary command: the element buttons still SHOOT
      // (`fire` is already set), they just do not ask for an element
      delete cmd.fireSel;
      delete cmd.shotPower;
    }
    // Tank control style is a PER-DRIVER input preference: "Normal" derives side-drive from
    // arcade driveY/rotate, "Traditional" keeps the raw separate-stick leftDrive/rightDrive. The
    // sim's tank branch always reads leftDrive/rightDrive. Runs after flip/park so both apply.
    if (drivingTank && ctx.tankControlMode === 'normal') {
      cmd.leftDrive = clamp(cmd.driveY - cmd.rotate, -1, 1);
      cmd.rightDrive = clamp(cmd.driveY + cmd.rotate, -1, 1);
    }
    // FTC25 TARGET SNAP — LAST, because while it runs it owns the drivetrain, as their TeleOp's
    // snap did: no translation, a turn toward the target. A stick past the cancel threshold ends
    // it and the driver drives that same frame.
    if (!ctx.forkFeatures) {
      this.snap = null;
      return cmd;
    }
    if (!this.snap && (input.snapAimPressed || input.snapAltPressed)) {
      const alt = !input.snapAimPressed;
      if (ctx.aimHeading(alt) !== null) this.snap = { alt, t: 0 };
    }
    if (this.snap) {
      const target = ctx.aimHeading(this.snap.alt);
      const turn = target === null ? null : ftc25SnapTurn(wrapAngle(target - r.heading), stickIn, this.snap.t);
      this.snap.t += ctx.dt;
      if (turn === null) {
        this.snap = null;
      } else {
        cmd.driveX = 0;
        cmd.driveY = 0;
        cmd.rotate = turn;
        cmd.leftDrive = -turn;
        cmd.rightDrive = turn;
      }
    }
    return cmd;
  }
}
