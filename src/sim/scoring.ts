import type { Alliance, ScoreBreakdown, World } from '../types';
import * as C from '../config';
import { other } from './field';
import { foulEventText } from './penaltyLog';

export function emptyScore(): ScoreBreakdown {
  return {
    leave: 0,
    autoClassified: 0,
    autoOverflow: 0,
    autoPattern: 0,
    teleClassified: 0,
    teleOverflow: 0,
    telePattern: 0,
    depot: 0,
    base: 0,
    foulPoints: 0,
    total: 0,
  };
}

function recomputeTotal(s: ScoreBreakdown): void {
  // A RED CARD voids the MATCH — the breakdown still shows everything that was earned,
  // because that is what happened on the field, but the total it counts for is zero.
  if (s.voided) {
    s.total = 0;
    return;
  }
  s.total =
    s.leave +
    s.autoClassified +
    s.autoOverflow +
    s.autoPattern +
    s.teleClassified +
    s.teleOverflow +
    s.telePattern +
    s.depot +
    s.base +
    s.foulPoints;
}

/** award a Section 11 foul: `offender` committed it, so the points go to the
 * OTHER (victim) alliance and the offender's committed-foul count bumps. */
export function awardFoul(
  world: World,
  offender: Alliance,
  severity: 'minor' | 'major',
  rule: string,
): void {
  const victim = other(offender);
  const pts = severity === 'major' ? C.PTS_FOUL_MAJOR : C.PTS_FOUL_MINOR;
  world.match.scores[victim].foulPoints += pts;
  recomputeTotal(world.match.scores[victim]);
  const tally = world.match.fouls[offender];
  if (severity === 'major') tally.major += 1;
  else tally.minor += 1;
  world.events.push(foulEventText(severity, victim, pts, rule));
}
