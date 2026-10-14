/**
 * WHERE THIS FORK'S FEATURES MAY ACT — and, more to the point, where they may not.
 *
 * This is a personal fork of DSIM (`my-changes`). Its additions — the FTC25 control scheme's
 * slow mode, shooter presets, element buttons and target snap, the preset table on a robot
 * (`AssistConfig.manualShot`), Local versus — are for this device and for LAN rooms. The owner's
 * rule (2026-10-12): **nothing of these changes may reach anything that syncs to BFSIM's own
 * servers or leaderboards.** So:
 *
 *  - SOLO (no session): everything acts.
 *  - A LAN ROOM — the desktop / `npm run lan` server reached by address, or a tab-hosted room
 *    (the lobby marks that match's SESSION, `markLanSession`), or a room this tab hosts
 *    (`tabHosting`): everything acts. The mark is on the session object, not a flag, so it can
 *    never outlive the match: a ranked match afterwards is a new session nobody marked. The room runs on a machine in the room, on this
 *    fork's own code.
 *  - ANY OTHER ROOM is on BFSIM's servers: the FTC25 layout still drives, intakes and shoots, its
 *    own buttons do nothing, and the robot is sent without its preset table.
 *
 * The other half of the rule — no run, match or setting carrying these changes is uploaded —
 * lives where the uploads are (`App.tsx`, `forAccount` in `settings.ts`).
 */
// NOT `./env`: it reads `import.meta.env` as it loads, which only a Vite build has, and this
// module is imported by headless code (the practice backlog, `npm test`). The lobby, which does
// know, marks a LAN match's session instead.
import { tabHosting } from '../lan/hosting';
import type { Replay } from '../sim/replay';

const lanSessions = new WeakSet<object>();

/** the lobby: this match's session is in a LAN room (a tab-hosted room it adopted, or a LAN
 *  server reached by address) */
export function markLanSession(session: object): void {
  lanSessions.add(session);
}

/** is this session's room run by a machine in the room? */
export function isLanSession(session: object): boolean {
  return lanSessions.has(session) || tabHosting();
}

/** may the fork's features act in this match? No session is solo play, where they always may. */
export function forkFeaturesAllowed(session: object | null | undefined): boolean {
  return !session || isLanSession(session);
}

/**
 * WAS THIS RUN PLAYED WITH THIS FORK'S FEATURES? Any seat spawned with the FTC25 preset table
 * (`AssistConfig.manualShot`) was driven with FTC25 controls — slow mode, presets, element
 * buttons and the target snap, none of which BFSIM's own clients have. Such a run is kept on the
 * device and never uploaded to BFSIM's servers (practice records, LAN history, the games-played
 * counter). A Local versus run is marked by its caller, since a second person on a DSim map
 * leaves nothing in the setups to see.
 */
export function replayIsFork(replay: Pick<Replay, 'setups'>): boolean {
  return replay.setups.some((s) => Array.isArray(s.assists?.manualShot));
}
