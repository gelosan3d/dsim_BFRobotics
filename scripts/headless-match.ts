/**
 * ONE HEADLESS BIOBUZZ MATCH, TWICE, FROM THE SAME SEED — `npx tsx scripts/headless-match.ts`.
 *
 * A measurement, not a test (nothing is wired into `npm test`): it plays a solo match (one bot on
 * blue, one idle robot on red) through AUTO and TELEOP, prints the score and the wall-clock cost,
 * then plays the SAME seed again and compares the final `worldHash` and every score line. Two
 * identical runs is the precondition for any search over autos or builds.
 *
 *   npx tsx scripts/headless-match.ts                         # seed 1, tier medium, 2D
 *   npx tsx scripts/headless-match.ts --seed 7 --tier hard
 *   npx tsx scripts/headless-match.ts --physics 3d            # slower, same seam
 *   npx tsx scripts/headless-match.ts --seconds 30            # the AUTO period only
 *   npx tsx scripts/headless-match.ts --out file.json         # also write header + replay container
 *   npx tsx scripts/headless-match.ts --verify file.json      # re-simulate a file, compare its hash
 *
 * The cross-machine procedure is docs/replay-determinism-test.md.
 */
import type { Physics } from '../src/games/types';
import type { RobotCommand, World } from '../src/types';
import * as C from '../src/config';
import { SIM_DT } from '../src/config';
import { DEFAULT_ASSISTS } from '../src/sim/spawn';
import { DEFAULT_SPEC } from '../src/sim/specDefaults';
import { initPhysics } from '../src/sim/physicsEngine';
import { BIOBUZZ_SIM } from '../src/games/biobuzz/sim';
import { bbScoreWorld } from '../src/games/biobuzz/score';
import { worldHash } from '../src/net/checksum';
import { localizeCommand } from '../src/net/protocol';
import { ReplayRecorder, simulateReplay, type Replay } from '../src/sim/replay';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

interface Args {
  seed: number;
  tier: string;
  physics: Physics;
  seconds: number;
  /** write the replay container here (JSON) */
  out?: string;
  /** instead of playing: re-simulate this replay file and compare with the hash in its header */
  verify?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { seed: 1, tier: 'medium', physics: '2d', seconds: 170 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === '--seed') out.seed = Number(v);
    else if (argv[i] === '--tier') out.tier = v;
    else if (argv[i] === '--physics') out.physics = v as Physics;
    else if (argv[i] === '--seconds') out.seconds = Number(v);
    else if (argv[i] === '--out') out.out = v;
    else if (argv[i] === '--verify') out.verify = v;
  }
  return out;
}

interface Result {
  hash: number;
  ticks: number;
  phase: string;
  blue: number;
  red: number;
  autoBlue: number;
  ms: number;
}

function playOnce(a: Args): Result {
  const t0 = Date.now();
  const setups = [
    { id: 0, alliance: 'blue' as const, spec: { ...DEFAULT_SPEC, name: 'bench', teamName: 'bench', teamNumber: 0 }, assists: { ...DEFAULT_ASSISTS }, startIndex: 0 },
    { id: 1, alliance: 'red' as const, spec: { ...DEFAULT_SPEC, name: 'idle', teamName: 'idle', teamNumber: 0 }, assists: { ...DEFAULT_ASSISTS }, startIndex: 1 },
  ];
  const world: World = BIOBUZZ_SIM.createWorld('match', a.seed, setups, undefined, a.physics);
  // start the way a replay does (`ReplayPlayer`): through the pre-match countdown, not `startMatch`,
  // so the recorded log re-simulates from the very same first tick
  world.match.preCountdown = C.PRE_COUNTDOWN;
  const drv = BIOBUZZ_SIM.bot!;
  // the same seed mix `game.ts` and `Room` use, so the bot is the one players meet
  const bot = drv.create(world, 0, a.tier, (a.seed ^ 0x9e3779b1) >>> 0);
  const rec = new ReplayRecorder(a.seed, setups, 'match', 'biobuzz', a.physics);
  const cmds = new Map<number, RobotCommand>();
  const maxTicks = Math.round(a.seconds / SIM_DT);
  let autoBlue = 0;
  let sawTeleop = false;
  let ticks = 0;
  while (ticks < maxTicks && world.match.phase !== 'post') {
    // step on the value the wire round-trips, exactly as a recorded run must (replay.ts header)
    cmds.set(0, localizeCommand(bot.step(world)));
    BIOBUZZ_SIM.step(world, SIM_DT, cmds);
    ticks++;
    rec.record(world.tick, cmds);
    // the first tick TELEOP is live is the end of AUTO: read what AUTO alone earned
    if (!sawTeleop && world.match.phase === 'teleop') {
      sawTeleop = true;
      autoBlue = world.match.scores.blue.total;
    }
  }
  const score = bbScoreWorld(world);
  const replay = rec.finish();
  return {
    hash: worldHash(world),
    ticks,
    phase: world.match.phase,
    blue: world.match.scores.blue.total,
    red: world.match.scores.red.total,
    autoBlue,
    ms: Date.now() - t0,
    // keep the full breakdown reachable for the diff below
    ...({ score, replay } as object),
  } as Result;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  await initPhysics();
  if (a.physics === '3d') {
    const { initPhysics3d } = await import('../src/games/biobuzz/sim3d/engine');
    await initPhysics3d();
  }
  if (a.verify) {
    // THE CROSS-MACHINE CHECK: no bot, no seed arguments. Load a file recorded elsewhere, step its
    // command log on THIS machine, and compare the final hash with the one its header recorded.
    const f = JSON.parse(readFileSync(a.verify, 'utf8')) as {
      meta?: { match?: { worldHash?: string; score?: { blue: number; red: number } }; build?: { commit?: string; dirty?: boolean } };
      replay: Replay;
    };
    if ((f.replay.physics ?? '2d') === '3d') {
      const { initPhysics3d } = await import('../src/games/biobuzz/sim3d/engine');
      await initPhysics3d();
    }
    const w = simulateReplay(f.replay);
    const got = (worldHash(w) >>> 0).toString(16);
    const want = f.meta?.match?.worldHash;
    console.log(`file:      ${a.verify}`);
    console.log(`recorded:  commit ${f.meta?.build?.commit?.slice(0, 8) ?? '?'}${f.meta?.build?.dirty ? ' (dirty)' : ''} · hash ${want ?? '?'} · score ${JSON.stringify(f.meta?.match?.score ?? null)}`);
    console.log(`this run:  hash ${got} · score {"blue":${w.match.scores.blue.total},"red":${w.match.scores.red.total}} · ${w.tick} ticks`);
    const ok = want !== undefined && got === want;
    console.log(ok ? '\nMATCH: this machine reproduces the recorded match exactly.' : '\nDIFFERENT: this machine does NOT reproduce the recorded match (or the header has no hash).');
    process.exit(ok ? 0 : 1);
  }

  console.log(`seed ${a.seed} · tier ${a.tier} · ${a.physics} physics · up to ${a.seconds}s of match\n`);

  const r1 = playOnce(a);
  const r2 = playOnce(a);
  const row = (n: string, r: Result): void =>
    console.log(
      `${n}: ticks ${r.ticks} · phase ${r.phase} · blue ${r.blue} (auto ${r.autoBlue}) red ${r.red} · hash ${(r.hash >>> 0).toString(16)} · ${r.ms} ms`,
    );
  row('run 1', r1);
  row('run 2', r2);

  const same =
    r1.hash === r2.hash && r1.ticks === r2.ticks && r1.blue === r2.blue && r1.red === r2.red && r1.autoBlue === r2.autoBlue;
  const full1 = JSON.stringify((r1 as unknown as { score: unknown }).score);
  const full2 = JSON.stringify((r2 as unknown as { score: unknown }).score);
  const sameFull = full1 === full2;
  console.log(`\nticks per second of wall clock: ${Math.round(r1.ticks / (r1.ms / 1000))}`);
  console.log(`match time simulated per wall second: ${(r1.ticks * SIM_DT / (r1.ms / 1000)).toFixed(1)}x real time`);
  // the replay: re-simulate the recorded log WITHOUT the bot and compare with the live match
  const replay = (r1 as unknown as { replay: Replay }).replay;
  const re = simulateReplay(replay);
  const replayOk = worldHash(re) === r1.hash && re.match.scores.blue.total === r1.blue;
  const trackEntries = Object.values(replay.tracks).reduce((n, t) => n + t.length / 7, 0);
  console.log(`replay: ${replay.ticks} ticks, ${trackEntries} command changes, ~${(JSON.stringify(replay).length / 1024).toFixed(1)} KiB`);
  console.log(replayOk ? 'REPLAY OK: re-simulating the log (no bot) reproduces the live match hash and score.' : 'REPLAY MISMATCH: the log does not reproduce the live match.');
  if (a.out) {
    // THE FILE: a small header describing where the replay came from, then the replay container
    // itself. The header is for people and for build checks; `replay` is all the sim reads.
    const git = (cmd: string): string => {
      try {
        return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        return '';
      }
    };
    const file = {
      dsimReplayFile: 1,
      meta: {
        createdAt: new Date().toISOString(),
        // who drove: a built-in bot at a tier, seeded the same way `game.ts` and `Room` seed it
        driver: { kind: 'bot', tier: a.tier, botSeed: ((a.seed ^ 0x9e3779b1) >>> 0), robotId: 0 },
        match: {
          game: 'biobuzz',
          mode: 'match',
          seed: a.seed,
          physics: a.physics,
          ticks: replay.ticks,
          finalPhase: r1.phase,
          score: { blue: r1.blue, red: r1.red, blueAuto: r1.autoBlue },
          worldHash: (r1.hash >>> 0).toString(16),
        },
        robots: replay.setups.map((s) => ({
          id: s.id,
          alliance: s.alliance,
          name: s.spec.name,
          drivetrain: s.spec.drivetrain,
          massLb: s.spec.massLb,
          startIndex: s.startIndex,
        })),
        // what produced it: the hand-bumped stamps AND the commit, because the stamps can lag
        build: {
          format: replay.format,
          balanceVersion: replay.balanceVersion,
          sim: replay.sim,
          patch: replay.patch,
          commit: git('rev-parse HEAD'),
          // tracked files only: the output file being written is itself untracked
          dirty: git('status --porcelain --untracked-files=no') !== '',
          branch: git('rev-parse --abbrev-ref HEAD'),
        },
        verified: { deterministicTwice: same && sameFull, reSimMatchesLive: replayOk },
        host: { node: process.version, platform: `${process.platform}-${process.arch}` },
      },
      replay,
    };
    // header pretty-printed (a person reads it), the replay compact (a machine does)
    const text = `{\n"dsimReplayFile": 1,\n"meta": ${JSON.stringify(file.meta, null, 1)},\n"replay": ${JSON.stringify(file.replay)}\n}\n`;
    writeFileSync(a.out, text);
    console.log(`wrote ${a.out} (header + replay)`);
  }
  console.log(same && sameFull ? '\nDETERMINISTIC: both runs identical (hash, ticks, scores, full breakdown).' : '\nDIVERGED: the two runs differ.');
  process.exit(same && sameFull && replayOk ? 0 : 1);
}

void main();
