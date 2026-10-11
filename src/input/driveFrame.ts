/**
 * THE MID-MATCH DRIVE-STYLE SWITCH (`driveFrame`, owner 2026-10-11: "add a headless / field
 * orientated driving method … a keybind to switch between headless and bot-orientated").
 *
 * The drive style a robot SPAWNS with is `RobotState.fieldCentric`, from the menu's Drive style
 * (`spec.assists`), and the sim reads it every tick (`updateRobot`, `driveIntent`,
 * `commandFieldDir`). The switch does NOT touch that flag. It re-expresses the stick, on the
 * client, in the frame the robot already reads — the way Flip front negates it — so:
 *
 *  - nothing on the wire, in a replay or on the server changes: the command a robot receives is
 *    an ordinary one, and `{seed, setups, commands}` still reproduces a run;
 *  - an older server, and every other client in the room, needs nothing;
 *  - the sim's three readers of `fieldCentric` stay in agreement, because they all see one
 *    consistent command.
 *
 * The heading is the client's LOCAL robot: predicted online, exact in solo. Online the server
 * steps the command a few ticks after it was sampled, so a robot spinning hard while it
 * translates drifts by the turn it makes in that window — the same lag every input already has.
 *
 * DOM-free and clock-free, so `npm test` holds it to the sim's own transform.
 */
import { rot } from '../math';
import type { Vec2 } from '../types';

/**
 * The stick a robot whose sim frame is the OPPOSITE of `field` must receive to drive as `field`
 * asks. `field` true: the driver's stick is in the driver's frame (up = away from the driver
 * station) and the robot reads it robot-centric. `field` false: up is the robot's own forward
 * and the robot reads it field-centric. The two transforms below are exact inverses.
 *
 * ⚠️ THE RESULT IS SCALED BACK INTO THE UNIT SQUARE, never clamped per axis. `quantizeCommand`
 * clamps each component to [-1, 1] before the wire, and a keyboard diagonal (1, 1) rotated by
 * 45° is (1.41, 0). Clamping per axis would bend the direction; a uniform scale keeps it, and
 * the drive model normalizes the stick by its demand anyway (`updateRobot`), so a full stick
 * stays a full stick.
 */
export function reframeStick(stick: Vec2, field: boolean, heading: number, viewAngle: number): Vec2 {
  let out: Vec2;
  if (field) {
    // driver frame → robot frame (what robot.ts does for a field-centric robot), then written
    // as the stick a robot-centric robot reads: robot forward is stick up, robot left stick left
    const v = rot(rot(stick, -viewAngle), -heading);
    out = { x: -v.y, y: v.x };
  } else {
    // the robot-centric reading (stick up = robot forward), carried back out to the driver frame
    out = rot(rot({ x: stick.y, y: -stick.x }, heading), viewAngle);
  }
  const m = Math.max(Math.abs(out.x), Math.abs(out.y));
  return m > 1 ? { x: out.x / m, y: out.y / m } : out;
}
