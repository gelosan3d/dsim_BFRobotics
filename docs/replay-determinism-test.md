# Replay determinism test (cross-machine)

**What this tests:** that a BIOBUZZ match recorded on one machine re-simulates to the *identical*
match on another. A replay is `seed + robot setups + a per-tick command log` (`src/sim/replay.ts`);
it only works if the sim steps to the same bits everywhere. Everything here is a **measurement**,
not part of `npm test`.

> ⚠️ **The replay file in this repo is a TEST FIXTURE, not a real match.**
> `testdata/TEST-ONLY_replay-determinism_seed1_medium-bot_2d.json` is one solo match (a built-in
> medium bot on blue, an idle robot on red), recorded to be re-simulated by this procedure. It is
> not a leaderboard run, a record, or something to upload. Do not treat its score as meaningful.

## What is in the file

```
{ "dsimReplayFile": 1,
  "meta":   { driver, match (seed, ticks, score, worldHash), robots, build (stamps + git commit),
              verified, host },
  "replay": { the container the sim reads: seed, setups, tracks, stamps } }
```

`meta.match.worldHash` is the answer key: the world hash at the final tick on the machine that
recorded it. The check is whether another machine produces the same hash. You never type the hash;
the script reads it from the header.

## Requirements

- The **same commit** on both machines (`git log -1`). Different commits make a mismatch
  meaningless. The file's `meta.build.commit` says which commit recorded it.
- Node 20 or newer. Use `npm ci` (not `npm install`) so the lockfile pins the same Rapier build.
- Ideally a **different OS or CPU** on the second machine (Windows/Intel vs Mac/Apple silicon).
  Two identical laptops prove little.

## Procedure

On the second machine:

```bash
git clone https://github.com/gelosan3d/dsim_BFRobotics
cd dsim_BFRobotics
git checkout my-changes
git log -1                       # note the commit; it should match meta.build.commit in the file
npm ci
npx tsx scripts/headless-match.ts --verify testdata/TEST-ONLY_replay-determinism_seed1_medium-bot_2d.json
```

Windows PowerShell: if `npx` is blocked, use `npx.cmd`.

### Expected output

```
file:      testdata/TEST-ONLY_replay-determinism_seed1_medium-bot_2d.json
recorded:  commit <8 chars> · hash 338eb809 · score {...}
this run:  hash 338eb809 · score {...} · 9724 ticks

MATCH: this machine reproduces the recorded match exactly.
```

(The hash in the file is whatever the recording machine produced; compare it with `this run`.)
Exit code is 0 on `MATCH`, 1 on `DIFFERENT`.

### A stronger second check (live bot, not just the log)

Record a fresh match on each machine with the same arguments and compare the printed hashes:

```bash
npx tsx scripts/headless-match.ts --seed 2 --tier medium
```

The `run 1` line ends in `hash ...`. Both machines should print the same value. This also covers
the bot's decisions, which `--verify` does not (it replays the recorded commands).

## Reading the result

| result | meaning |
|---|---|
| `MATCH` | the sim is bit-identical here for this match. Good evidence, not proof for every scenario |
| `DIFFERENT` | a real divergence: floating-point, a different physics build, or a different commit |
| refused / error | the file's stamps (`sim`, `balanceVersion`) do not match this build |

If it is `DIFFERENT`: first confirm both machines are on the same commit and `npm ci` was used.
If they are, keep both outputs (the whole of each) and compare where the hashes first split. The
likely cause is the 2D physics build (`@dimforge/rapier2d-compat`, not the deterministic variant).

## Making a new fixture

```bash
git status                       # must be clean for meta.build.dirty to be false
npx tsx scripts/headless-match.ts --seed 1 --tier medium --out testdata/TEST-ONLY_replay-determinism_seed1_medium-bot_2d.json
```

Commit the file. Re-record whenever the sim changes, because `SIM_VERSION`/`SIM_PATCH` and the
behaviour it pins move the hash.

## Limits (be honest about what this proves)

- It checks one match under 2D physics. It does not cover 3D physics (`--physics 3d`), other
  seeds, 2v2, or other builds unless you run them.
- Matching on two machines of the same engine family (Node/V8) says little about other engines.
- The version stamps are bumped by hand; the commit in the header is the better guard.
