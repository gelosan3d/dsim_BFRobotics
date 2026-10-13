import type { RobotSpec } from '../types';
import type { GameId } from '../games/types';
import { moduleFor } from '../games';
import { CHAIN_CATALYST_LABELS, CHAIN_CATALYST_MOUNT_LABELS, CHAIN_MODE_LABELS, CHAIN_SHOOTER_MOUNT_LABELS } from '../games/chain/labels';
import { CHAIN_DEFAULT_CATALYST, CHAIN_DEFAULT_SCORE_MODE } from '../games/chain/config';
import { catalystMountOf, catalystSwingOf, isTurreted, shooterMountOf } from '../games/chain/mounts';
import { DRIVETRAIN_LABELS, INTAKE_SHORT } from './labelData';

/**
 * The two label maps moved to the LEAF `./labelData` and are RE-EXPORTED here, so every
 * existing importer of this module is unchanged. They had to move: this file imports
 * `moduleFor`, so anything importing it pulls in every game module — and a game module that
 * wants to label a drivetrain on its own preset card would close that loop at evaluation
 * time. See the header of `./labelData`.
 */
export { DRIVETRAIN_LABELS, INTAKE_SHORT };

/**
 * ONE LINE describing a build, in the terms that game actually has: Chain Reaction names
 * the archetype, and a game with its own words fills `labels.configSummary` (BIOBUZZ does).
 * Lives here rather than in a screen because THREE screens
 * print it now — the ranked strategy window, the custom-room lobby, and anywhere
 * else a roster card wants to say what somebody is bringing — and two hand-written
 * copies of one sentence drift the way any two drawings of one object do.
 */
export function buildSummary(spec: RobotSpec, game: GameId): string {
  // a game may own this sentence outright (the module's `labels.configSummary` slot); the
  // inline sentence is Chain Reaction's (the other arm was DECODE's, removed 2026-10-12)
  const own = moduleFor(game).labels?.configSummary;
  if (own) return own(spec);
  return [
    DRIVETRAIN_LABELS[spec.drivetrain],
    CHAIN_MODE_LABELS[spec.scoreMode ?? CHAIN_DEFAULT_SCORE_MODE],
    `${spec.driveRpm} rpm`,
    `${spec.massLb} lb`,
  ].join(' · ');
}

/**
 * THE SHORT FORM OF A BUILD: the drivetrain, then the mechanisms that make it this robot and
 * not another. What a robot CARD prints under its name (a saved robot, a preset, the swap row in
 * the lobby and the ranked strategy window) and what the builder hero prints under the team.
 *
 * `buildSummary` above is the LONG form a roster or leaderboard row prints, and it stays: it
 * carries the rpm and mass a card leaves to the hero's stat grid. This one has no numbers at all,
 * because every card that prints it sits beside a control that already shows them, and a card
 * whose line is a spec dump is the clutter the owner asked to be rid of (2026-09-22).
 *
 * A game that fills `statTiles` gets ITS mechanisms, read through its own resolvers — the same
 * slot rule `buildSummary` follows for `labels.configSummary`, and for the same reason: an `else`
 * arm here is not a default, it is somebody else's game. Chain Reaction fills nothing and takes
 * the inline arm.
 */
export function buildWords(spec: RobotSpec, game: GameId): string[] {
  const words = [DRIVETRAIN_LABELS[spec.drivetrain]];
  const tiles = moduleFor(game).statTiles?.(spec);
  if (tiles) {
    for (const t of tiles) if (!t.absent) words.push(t.sub ? `${t.value}, ${t.sub}` : t.value);
  } else {
    const mode = spec.scoreMode ?? CHAIN_DEFAULT_SCORE_MODE;
    // a turret aims itself from wherever it is bolted, so its mount says nothing
    words.push(
      isTurreted(mode)
        ? CHAIN_MODE_LABELS[mode]
        : `${CHAIN_MODE_LABELS[mode]}, ${CHAIN_SHOOTER_MOUNT_LABELS[shooterMountOf(spec)]}`,
    );
    const swing = catalystSwingOf(spec);
    words.push(
      `${CHAIN_CATALYST_LABELS[spec.catalystType ?? CHAIN_DEFAULT_CATALYST]}${
        swing ? ` swing ${swing === 'fb' ? '↕' : '↔'}` : ''
      }, ${CHAIN_CATALYST_MOUNT_LABELS[catalystMountOf(spec)]}`,
    );
  }
  return words;
}

/**
 * A robot's TEAM, the way FTC writes one: number, then name (`12345 · Robo Hornets`). Empty when
 * the build carries neither, and then the line is not printed at all — a "No team" placeholder
 * said nothing the missing line does not.
 */
export function teamLine(spec: Pick<RobotSpec, 'teamName' | 'teamNumber'>): string {
  return [spec.teamNumber ? String(spec.teamNumber) : '', spec.teamName.trim()].filter(Boolean).join(' · ');
}
