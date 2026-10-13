/**
 * THE FTC25 TARGET SNAP'S AIM POINT IN BIOBUZZ (`GameSimModule.aimHeading`; owner, 2026-10-12:
 * "change the snap angles so they snap towards the hive"). Team 2627's snaps turned to ±45° — the
 * DECODE goal diagonals — and here the same two buttons turn the robot's SHOOTER to face its own
 * HIVE: the cell that is taking elements right now (`hiveTakingSide`), or, on the other button,
 * the cell at the other end of the seesaw, which is the one that comes up after the next tip.
 *
 * The SHOOTER faces it, not the nose: a dumper fires off its mounted edge (`bbShooterEdgeOf`),
 * and a turret on the centre reads as the front. DOM-free; read on the client only, by the
 * driver's input shaping — the sim never calls it.
 */
import type { RobotState, World } from '../../types';
import { datan2, wrapAngle } from '../../math';
import { BB_HIVE_UP_STAGED } from './config';
import { hiveCellPos, hiveTakingSide, otherSide } from './hive';
import { bbShooterEdgeOf, type BbEdge } from './mounts';
import type { BiobuzzState } from './state';

/** where each edge points, relative to the robot's heading (CCW positive) */
const EDGE_OFFSET: Record<BbEdge, number> = { front: 0, left: Math.PI / 2, back: Math.PI, right: -Math.PI / 2 };

export function bbSnapHeading(world: World, r: RobotState, alt: boolean): number {
  const hive = (world.biobuzz as BiobuzzState | undefined)?.hives?.[r.alliance];
  const taking = hive ? hiveTakingSide(hive) : BB_HIVE_UP_STAGED[r.alliance];
  const cell = hiveCellPos(r.alliance, alt ? otherSide(taking) : taking);
  const toward = datan2(cell.y - r.pos.y, cell.x - r.pos.x);
  return wrapAngle(toward - EDGE_OFFSET[bbShooterEdgeOf(r.spec)]);
}
