import type { Alliance, RobotSpec, Vec2 } from '../types';
import * as C from '../config';
import { intakeMountOf } from '../games/chain/mounts';

export type { StartPose } from '../types';

/**
 * THE SHARED FIELD FRAME, used by every game (DECODE's own geometry — goals, launch zones,
 * base and loading zones — went with DECODE, 2026-10-12):
 *
 * World frame: origin at field center, +x = audience's right, +y = away from
 * the audience. Red Wall (red ALLIANCE AREA) is the LEFT wall (x = -72),
 * Blue Wall is the RIGHT wall (x = +72), and each drive team views the field
 * from its own wall (`viewAngleOf`).
 */

/** the opposing alliance */
export const other = (a: Alliance): Alliance => (a === 'blue' ? 'red' : 'blue');

/** which side wall the alliance's GOAL corner is on: blue -1 (left), red +1 */
export const goalSide = (a: Alliance): number => (a === 'blue' ? -1 : 1);
/** which side wall the alliance's DRIVE TEAM / loading zone is on */
export const driverSide = (a: Alliance): number => -goalSide(a);

/** camera/world rotation so the driver views the field from their wall:
 * screen-up points from the driver's wall into the field */
export const viewAngleOf = (a: Alliance): number =>
  driverSide(a) === 1 ? -Math.PI / 2 : Math.PI / 2;

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const inRect = (p: Vec2, r: Rect): boolean =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/** footprint extents in the robot frame (chassis + intake reach). Single source
 * of truth reused by physics.robotExtents and the G304 start validator. */
export function footprintExtents(spec: RobotSpec): { front: number; rear: number; half: number } {
  const reach = C.INTAKE_PRESETS[spec.intake].reach;
  // The intake is a PHYSICAL part of the robot, so it extends the collision hitbox on whichever
  // edge(s) it is mounted on (Chain Reaction lets it move; a spec that names no mount gets
  // `intakeMountOf`'s front default). A `frontback` sweeper is deeper fore-and-aft on BOTH
  // ends; a `side` sweeper is wider instead.
  const mount = intakeMountOf(spec);
  const ends = mount === 'front' || mount === 'frontback';
  const rear = mount === 'back' || mount === 'frontback';
  return {
    front: spec.length / 2 + (ends ? reach : 0),
    rear: spec.length / 2 + (rear ? reach : 0),
    half: spec.width / 2 + (mount === 'side' ? reach : 0),
  };
}
