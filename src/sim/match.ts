import type { World } from '../types';
import * as C from '../config';

/** begin the match (pre -> auto) */
export function startMatch(world: World): void {
  if (world.match.phase !== 'pre') return;
  world.match.phase = 'auto';
  world.match.phaseTimeLeft = C.AUTO_DURATION;
  world.events.push('AUTO');
}

/** may the robots move right now? */
export function robotsEnabled(world: World): boolean {
  const p = world.match.phase;
  return p === 'auto' || p === 'teleop' || p === 'freeplay';
}
