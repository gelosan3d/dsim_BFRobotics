import type { DrivetrainType } from './types';

/**
 * Single source of truth for all field geometry, physics constants, and
 * scoring values. Units: inches, seconds, radians. Field frame: origin at
 * field center, +x = audience's right, +y = away from the audience.
 *
 * Red Wall = left (x=-72), Blue Wall = right (x=+72). DECODE's own field
 * geometry (goals, launch zones, gate and ramp) went with DECODE, 2026-10-12;
 * what is left here is shared by every game — the robot, drivetrain, motor
 * and match constants — plus the few DECODE-tuned values another game still
 * reads (the fallback artifact radius, the foul tariff). See src/sim/field.ts
 * for the shared frame.
 */

export const FIELD_HALF = 72; // 144 x 144 in field
export const TILE = 24;
export const TAPE_W = 1;

// ---------------------------------------------------------------- match ----
export const AUTO_DURATION = 30;
export const TRANSITION_DURATION = 8;
export const TELEOP_DURATION = 120;
/** END GAME: the final stretch of TELEOP (warning cue + HUD urgency) */
export const ENDGAME_START = 20; // s left in teleop
/** announcer countdown after pressing start ("Match begins in" + 3,2,1) */
export const PRE_COUNTDOWN = 4;
// WHEN A MATCH IS OVER after the buzzer is decided by the field coming to rest, not by a fixed
// delay — see `src/sim/settle.ts` (`MATCH_SETTLE_HOLD_S`, `MATCH_SETTLE_MAX_S`). The old
// `MATCH_SETTLE_S` / `MATCH_RESULT_REVEAL_MS` 2.8 s timer is gone on purpose.

// --------------------------------------------------------------- season ----
/** Balance / season version. Leaderboards (Phase 3) are keyed to this: it is
 * bumped DELIBERATELY on a gameplay-affecting balance change (any physics or
 * scoring constant below that would move a record's score), which starts a
 * fresh ranked season and archives the previous one. Every record + replay is
 * stamped with the value in effect when it was set, because a deterministic
 * input-log replay only re-simulates to the same score under the exact sim
 * build that produced it. Do NOT auto-derive this from a file hash — that would
 * reset every season on a trivial, non-gameplay edit. See docs/netcodeplan.md
 * Phase 3 + the phase3-leaderboards spec. */
export const BALANCE_VERSION = 4; // 2: real-motor drivetrain retune (torque–speed curve + mecanum losses)
// 3: swerve wobble ↓ + faster turning (REF_TURN 8.5 / cap 12) + tank control-style at input layer
// 4: robot-on-robot pushing rebuilt — push is a stated FORCE and the collider mass is derived
//    from it, so weight, gearing and power draw each act ONCE instead of cancelling or landing
//    twice (a 250 rpm minimum-weight mecanum used to out-push a 42 lb 435 rpm tank). Every
//    head-to-head outcome moves, and the stiffer robot contact moves solo record scores too.
// Bumping this INVALIDATES older replays for playback (they only re-sim exactly under their own
// version's build): ReplayView gates on it and shows "recorded on an older version" instead.
//
// ⚠️ **THE BUMP TO 5 WAS DECLINED AT THE MERGE, AND THE SEASON RUNS ON** (owner, 2026-09-17).
// The alpha batch merged into main on that date WITHOUT a bump: the score-moving changes below
// are live on 4, deliberately, because bumping archives the standings for everyone on the one
// Fly app and the owner chose to keep the season rather than reset it over them. So a record
// set before this merge and one set after share a board although the scoring moved under them
// — that is the accepted cost, not an oversight. The list stands as the record of what moved,
// and a later bump starts its season from here rather than re-litigating any of it.
// 2026-09-15, superseded: the batch DOES move scores, so by the rule above it had earned one:
//   · BIOBUZZ — a TIP still swinging at the buzzer is scored as the TIP it becomes and its load
//     is no longer also paid as left in the CELL (§10.5 A/C, `games/biobuzz/score.ts`);
//   · every game — a match is finalized when the FIELD COMES TO REST rather than at a fixed
//     2.8 s (`sim/settle.ts`), so anything still scoring after the buzzer now lands.
// What it has NOT earned is a new SEASON, which is the other thing this number does. That was
// the reason to hold the bump while the changes were alpha-only, and at the merge it became the
// reason to decline it outright. Add to the list above rather than bumping; if a later change
// makes the accumulated drift unshippable without a reset, that is the moment to reconsider.

/**
 * SIM BEHAVIOUR version — "which builds can re-simulate a replay", which is a
 * DIFFERENT question from "which competitive season is this".
 *
 * BALANCE_VERSION answers the second: it keys leaderboards, so bumping it starts
 * a fresh season and archives the standings. That makes it the wrong tool for the
 * first. A determinism or float-level physics FIX changes what `step()` produces
 * without being a balance decision at all — and shipping one has only two
 * outcomes if this axis doesn't exist: reset everyone's season over a bug fix, or
 * leave stored replays silently re-simulating into a different game than the one
 * that was played. That second option is the exact failure this constant exists
 * to prevent, so it gets its own number.
 *
 * Bump on ANY change to sim math, physics, or step ordering that moves the
 * output. Never reset it. Leaderboards, ELO and seasons DO NOT read it — only
 * replay playback does (`ReplayView` refuses a mismatch and says so).
 *
 * ALPHA SHIPS AS 3. The old rule here was "hold at 2 until MAIN moves or alpha ships"; BOTH
 * happened. Main took 2 for its own batch, and alpha kept stamping 2 for a DIFFERENT batch —
 * so for a while two builds stamped the same number over two behaviours, which is the exact
 * failure this constant exists to prevent. 3 is alpha's, and the same rule applies to it:
 * everything inside one unreleased batch rides one number, and the next bump is the next
 * time main moves or alpha ships again.
 *
 * ⚠️ A BUMP RETIRES NOTHING. `replayRefusal` (`src/sim/replay.ts`) compares this int and
 * returns `behaviour`, which is a DRIFT — the replay still plays, labelled "the ending may
 * land differently". Only the SEASON (`BALANCE_VERSION`) and an unreadable container refuse.
 * That is why bumping for a physics batch is cheap and leaving it un-bumped is not.
 *
 * 1: sim-reachable Math.hypot -> hyp (engine-independent; see src/math.ts).
 * 2: TWO DIFFERENT BATCHES SHARE THIS NUMBER, one on each branch — main's and alpha's below.
 *    Alpha's is everything listed under this entry; main is at 2 with its own. A container
 *    stamped 2 therefore does not say which behaviour recorded it, which is why alpha moved
 *    on rather than re-using it. Alpha's 2, all of which moves `step()` output:
 *    · CR butterfly drivetrain / twin turret / catalyst mechanisms / corner geometry /
 *      start legality;
 *    · DECODE's G418.B fix — a gate tap no longer bills the standing ramp column;
 *    · ROBOT-ON-ROBOT PUSHING rebuilt: the shove is a stated FORCE with the collider mass
 *      derived from it (`pushForce`/`shoveMass`), so weight, gearing and power draw each act
 *      once instead of cancelling or landing twice; a shoved chassis gets a real two-body
 *      contact impulse, so an off-centre hit spins it; the press scaling every robot-robot
 *      response is the pair's CLOSING velocity, not each robot's absolute one; a robot held
 *      against a surface by an opponent feels that load; an auto-path robot is solid instead
 *      of intangible; pair and static responses are summed before either is written; and
 *      contacts are stiffer (PHYS_CONTACT_FREQ 8 -> 12);
 *    · THE DECODE INTAKE GRABS AT THE ROLLER NIP, and reaches only what has LANDED on it:
 *      one fore-aft band about `intakeAxleX` derived from the roller's own geometry replaces
 *      three hand-written x-ranges (`intakeNip`/`INTAKE_TREAD_FRAC`), `intakeSuction`'s reach
 *      is the landing bound `tip + BALL_RADIUS − INTAKE_CATCH_LENIENCE` instead of
 *      `tip + BALL_RADIUS` (+ the wedge lip), the swallow cadence is 1-2 ticks with `drawIn`
 *      up by half, and `intakeClaims`' lateral covers the suction's own outer band;
 *    · G422 PINNING rewritten against the rule's own clauses — "preventing the movement"
 *      requires the pinner to be IN THE WAY of where the victim is trying to go, "attempting
 *      to move" reads side-drive so a tank can be pinned at all, the count ends only on
 *      criteria A/B/C (pausing and resuming rather than dying on a 0.6 s lapse), and it bills
 *      a MINOR every 3 s instead of one MINOR with an invented MAJOR escalation;
 *    · G408 OVER-POSSESSION rewritten against DECODE's CONTROL definition instead of an FRC
 *      POSSESSION and an invented TRAPPING (neither term is in this manual). Control is
 *      ACQUIRED by herding — a flat-or-concave face, the robot moving the artifact a real
 *      DISTANCE in the push direction, sustained past the confirm window — and LATCHES while
 *      contact holds, so a pile driven into the wall keeps counting while one already resting
 *      there never starts. An established hold keeps counting while it DRAINS, because
 *      artifacts bounce off a bumper rather than riding it. The mouth carve-out is capped at
 *      what the rollers take in one cycle rather than at hopper room, the loading-zone
 *      carve-out is scoped to a robot actually in there, an excused artifact conducts the
 *      transitive chain without being counted, and the per-artifact clocks are swept and
 *      cleared outside auto/teleop;
 *    · PENALTIES ARE ASSESSED IN FREE DRIVE — `freeplay` is a live phase everywhere else in
 *      the sim, and `updatePenalties` was the one place that excluded it;
 *    · a robot-robot contact that is SLIDING no longer aligns the pair, so a pusher is not
 *      steered by the victim escaping it (`CONTACT_SLIP_RELIEF`);
 *    · G422 no longer needs a WALL — an open-field pin is billed, with the asymmetry coming
 *      from the pinner driving in and from a cornered robot counting as escaping, not pinning;
 *    · G422 no longer needs the victim to be struggling — an idle victim held against a wall
 *      is pinned, gated instead on the PINNER driving into it (`PIN_PRESS_COS`);
 *    · G422 recognises the ORDINARY WALL PIN. The obstruction test asked whether the PINNER
 *      lay along where the victim was trying to go — true of a straight reverse, false of every
 *      SIDEWAYS exit — so a robot held flat against a wall and strafing to get out was ruled
 *      un-pinned however stuck it was, and billed NOTHING where the pre-rewrite code billed a
 *      MINOR. It now tests the VICTIM's intent instead (is it driving into the trap, or trying
 *      to leave), which is what the rule's "transitive ... against a FIELD element" describes;
 *    · BUMPER FRICTION IS BOUNDED (`capDrag`). The sim pushes by SETTING VELOCITY, so Rapier's
 *      normal impulse is whatever a drive-in costs and its Coulomb friction was a fraction of
 *      an unbounded number — a tank commanding nothing but straight forward was carried 58in
 *      sideways by a mecanum strafing out from under it, 101% of the victim's own travel. The
 *      tangential half of a contact is now capped by what the other robot can actually press
 *      with and by the tyres it is pulling against, and a sideways exit along an open wall is
 *      a real escape again (which is why the G422 wall-pin check is now the CORNER);
 *    · AN UNPOWERED ROBOT NO LONGER BRAKES AGAINST A SHOVE at full stopping authority
 *      (`MOTOR_SHOVE_BRAKE`) — three seconds of full throttle moved an idle equal chassis
 *      15.5in, now 95in.
 *    · BUMPER FRICTION RETUNED to the owner's call, twice and in that order: 0.45 -> 0.2
 *      (`a97f03c`), then robot-on-robot alone to 0.15 with `PHYS_WALL_FRICTION` raised
 *      0.35 -> 0.65 to compensate (`914bc1b`), because Rapier AVERAGES a pair's coefficients
 *      and one constant is therefore all of robot-robot and half of robot-wall. Robot-wall is
 *      held at the 0.40 it has always been, which is what keeps the gate arms — they run
 *      through the same `statics()` helper — turning a robot exactly as before. Listed here
 *      rather than given its own number for the reason stated above: this is still the one
 *      unreleased alpha batch, and the entry exists so the batch's contents stay honest.
 *    · ZONE FOUL HITBOXES corrected against Section 9, on two independent counts. G424 was
 *      testing `gateZone()`, the generous rect that decides whether a robot can WORK the gate,
 *      instead of the GATE ZONE the rule protects — 10x5 from the wall against the manual's
 *      2.75x10 from the classifier edge, two rects sharing about 4in of the zone's 10in
 *      length, so the foul ran 6in into the classifier channel and not at all over the outer
 *      6in of the real zone (`gateZoneTape`). And G425/G426/G427 asked whether a CORNER or the
 *      CENTRE was inside their zone, where every DECODE zone is an "infinitely tall volume"
 *      and the rules ask whether a ROBOT "is in" one — so the test is overlap against the
 *      top-down silhouette, which is what G424 alone already did. Both moved which contacts
 *      draw fouls, hence this entry; BASE PARKING is untouched and still counts wheel support,
 *      because that award is defined by what the TILE holds up, not by occupancy.
 * 3: THE BIOBUZZ 2D BATCH — alpha's `step()` output for `{seed, setups, commands}` already
 *    differed from main's for a BIOBUZZ world while both stamped 2. None of it was ever
 *    listed here (the hive-feel work of 2026-09-13 landed without an entry, which is the
 *    honesty hole this entry closes), so the list below is written from the code rather
 *    than from the commit messages:
 *    · THE SPILL DRAWS SIX RNG VALUES PER ELEMENT, not four (`spillPoses`, hive.ts): x, y,
 *      speed, fan angle, then the KICK's direction and magnitude. The rng chain is shared and
 *      CONSUMED, so two extra draws per spilled element move every later draw in the match —
 *      this alone is enough to make two builds disagree from the first spill onward. The
 *      count now has its own tripwire in the FIELD lane; see the note there before changing it;
 *    · `hiveDeflect` — a missed shot bounces off the structure and drops beside it instead of
 *      passing through, so a miss now writes a position and a velocity where it wrote nothing;
 *    · LOAD-DRIVEN `hiveSwingRate` — a heavier tray tips faster, so `tipping` decrements at a
 *      rate that depends on the cell's contents and the spill happens on a different tick;
 *    · FIELD GEOMETRY RE-POINTED AT THE CAD (owner ruling 2026-09-17, `fieldDims.gen.ts`):
 *      `BB_HALF_X`/`BB_HALF_Y` 72 -> 70.674, `BB_FLOWER_TOP_Z` 21.5 -> 21.404, and with them
 *      `BB_FLOWER_MID_Z`, `BB_FLOWER_FLOOR_Z`, `BB_FLOWER_D`, `BB_FLOWER_OPEN_R`,
 *      `BB_HIVE_CELL_DY`, `BB_HIVE_LEN`, and `BB_HIVE_BOTTOM_Z` 25.5 -> 31.981. Every wall
 *      bounce, every flight test and every stack height is a different number;
 *    · THE 2D INTAKE REWRITTEN — `intakeTick` / `bbIntakeAct`'s pull phase draws an element in
 *      over ticks against a force model instead of teleporting it on the capture tick;
 *    · `bbSnapSize` — a chassis dimension is SNAPPED to the builder slider's grid rather than
 *      merely clamped to it, so a setup carrying an off-grid length simulates at a different
 *      footprint than it did on 2.
 *    ⚠️ REPLAYS RECORDED BETWEEN 2026-09-13 AND 2026-09-17 ARE MIS-STAMPED. They say 2 and
 *    they ran the six-draw spill (and, depending on the day, some of the rest of this list),
 *    because the behaviour moved and the number did not. A v3 build reads them as `behaviour`
 *    and plays them as DRIFT, which is the right outcome — it cannot tell them apart from a
 *    genuine 2, and drift is the label that says "the ending may land differently".
 * 4: THE STUCK-ROBOT BATCH (replay 1dc6eb8f, 2026-09-25: a BIOBUZZ ramp robot frozen from 1:50
 *    to the buzzer). Everything stamped 3 before it plays as DRIFT. It also closes the honesty
 *    hole BIOBUZZ 3D left open: 3D behaviour moved several times on 3 (the turret rest pitch of
 *    2026-09-24, the ramp work of 2026-09-20/21) without a number.
 *    · TOGGLES ARE DEBOUNCED (`debouncedPress`, `TOGGLE_DEBOUNCE_S`): a release under 2.5 ticks
 *      is not a release, for butterfly `driveMode` (DECODE and Chain Reaction too) and the
 *      BIOBUZZ ramp;
 *    · THE BIOBUZZ 3D RAMP GUARD re-tests a reversed deploy and folds on a second hit, and a
 *      settled ramp a fixed body presses vertically folds (`bbRampSwingStep3d`);
 *    · A BIOBUZZ 3D CHASSIS PLACED INSIDE A FIXED PART (a new body, a gameplay move, the
 *      deploy-edge rebuild) is set down beside it, same height and heading (`setChassisClear`),
 *      instead of being lifted onto the hive foot bar and wedged there for good;
 *    · A BIOBUZZ 3D ROBOT MEETS A FLOWER'S MIDDLE AND TOP RING PLATES AS SOLID BOXES and no plate
 *      trimesh (`buildFlowerSolids3d`, `GROUP_CHASSIS`), so a chassis is no longer lifted onto the
 *      0.35-in lower lip or pushed into the tiles; the three plate trimeshes are one collider now,
 *      which moves Rapier's pair order. Elements meet the same surfaces as before.
 */
export const SIM_VERSION = 4;

/**
 * A BEHAVIOUR FIX SMALL ENOUGH NOT TO RETIRE EVERY REPLAY. `SIM_VERSION` refuses every older
 * replay in every game; a patch keeps them playing by re-running the OLD rule for them. A
 * replay carries the patch it was recorded under (`Replay.patch`, absent ⇒ 0), `ReplayPlayer`
 * copies it onto its world (`World.simPatch`), and each gated rule asks
 * `world.simPatch === undefined || world.simPatch >= n`. A LIVE world never carries the field,
 * so it always runs the current rules and nothing new rides the wire.
 *
 * ⚠️ MONOTONIC: never reset it, including at a `SIM_VERSION` bump — a gate reads `>= n`, and a
 * reset would send new replays down an old branch. After a bump the old branches are dead code
 * (their replays are refused) and may be deleted.
 *
 *   1  BIOBUZZ 3D: an element joins a FLOWER through the top only (`sim3d/derive.ts`).
 *      Live on the site 2026-09-27 08:34:35Z, on the game server 17:14–17:16Z.
 *   2  BIOBUZZ 3D: a hive cell's floor and back colliders stand `BB3_TRAY_OUTER_SKIN` (0.5 in)
 *      out past the CAD surface instead of 1.5, so a NECTAR no longer wedges between the down
 *      cell and the ACM panel (`sim3d/bodies.ts`, `trayOuterSkin`).
 *   3  (`alpha`) BIOBUZZ 3D: the wall square-up is a turn the solve makes. It reached this branch
 *      as 8, below.
 *   4  (`alpha`, not on this branch) FIXED LAUNCHERS: the aim assist turns with `fixedAimTurn`.
 *      The numbers are shared across branches so a replay means the same thing on both. A replay
 *      this branch stamps 5 did NOT run 3 or 4; `alpha` carries `SIM_VERSION` 5, so once it lands
 *      here every replay stamped 4 plays as DRIFT anyway, which is the honest label for that.
 *   5  BIOBUZZ 3D: a loose element the narrow-hull vibration cannot free from HIVE structure is
 *      SHED off it (a hashed hop, `BB3_HIVE_SHED_*`) instead of frozen on top of the HIVE for the
 *      rest of the match (`sim3d/engineImpl.ts`, `groundRoll3d`).
 *   6, 7 (`alpha`, not on this branch) imported side rollers; a robot at a FLOWER meets the plates'
 *      measured outline.
 *   8  BIOBUZZ 3D: `alpha`'s 3 — the wall square-up is a turn the SOLVE makes (one tick of extra
 *      yaw rate), not a heading written after it (`sim3d/step3dImpl.ts` stage 6b); the online wall
 *      bump. A new number here because a replay this branch stamped 5 did NOT run it.
 */
export const SIM_PATCH = 8;

/** a toggle-button release shorter than this is a dropout, not a release (`debouncedPress`,
 * `src/sim/robot.ts`). 2.5 ticks: a 3-tick gap, the fastest real re-press in replay 1dc6eb8f,
 * counts; a 1–2-tick dropout does not. */
export const TOGGLE_DEBOUNCE_S = 2.5 / 60;

/** Ranked PLACEMENT, per mode: a player is "in placements" until they've completed this many
 * ranked games on a board. Until placed they are HIDDEN from the leaderboard (and from the
 * act's podium awards, which read it), and shown a "?" plus an "N matches until placement"
 * line. Games-based, not RD-based: Glicko RD shrinks only slowly when opponents are themselves
 * uncertain, so an RD test kept the "?" for dozens of games.
 *
 * 10 and 7 since 2026-10-03 (owner), up from 5 for both: a player 5-0 at RD ~200 topped the
 * BIOBUZZ board over people with 30 games. Archived seasons keep 5 (`boardMinGames` in
 * server/db/repo.ts), so a past board still names the players its awards did. */
export const RANKED_PLACEMENT: Readonly<Record<'1v1' | '2v2', number>> = { '1v1': 10, '2v2': 7 };
export const placementGamesFor = (mode: '1v1' | '2v2'): number => RANKED_PLACEMENT[mode];

/** The games a rating needs before the MATCHMAKER trusts it: the 1v1 skill gate and the 2v2
 * seed's weights (`server/matchmaking.ts`). Was also the player-facing placement until
 * 2026-10-03 (see `RANKED_PLACEMENT`); the matchmaker kept 5 because it is a statistical
 * threshold, not a public one. */
export const PLACEMENT_GAMES = 5;

/** Ratings never print below this. Glicko has no floor of its own, so a long enough losing
 *  run — or a run of behaviour charges (see `src/standing.ts`) — would otherwise show a
 *  player a number that reads as broken rather than as bad. */
export const RATING_FLOOR = 400;

// --------------------------------------------------------------- fouls -----
/** Section 11 penalties, awarded TO the OPPOSING (victim) alliance. Straight from the
 * DECODE glossary (Section 16): a MINOR FOUL is "a credit of 5 points", a MAJOR FOUL "a
 * credit of 15 points", towards the MATCH point total. */
export const PTS_FOUL_MINOR = 5;
export const PTS_FOUL_MAJOR = 15;
/**
 * G422, verbatim, because every constant below is a clause of it:
 *
 *   "There is a 3-count on PINS. A ROBOT may not PIN an opponent's ROBOT for more than 3
 *    seconds. A ROBOT is PINNING if it is preventing the movement of an opponent ROBOT by
 *    contact, either direct or transitive (such as against a FIELD element) and the opponent
 *    ROBOT is attempting to move. A PIN count ends once any of the following criteria below
 *    are met:
 *      A. the ROBOTS have separated by at least 2 ft. (~61 cm) from each other for more than
 *         3 seconds,
 *      B. either ROBOT has moved 2 ft. from where the PIN initiated for more than 3 seconds, or
 *      C. the PINNING ROBOT gets PINNED.
 *    For criteria A, the PIN count pauses once ROBOTS are separated by 2 ft. until either the
 *    PIN ends or the PINNING ROBOT moves back within 2 ft., at which point the PIN count is
 *    resumed. For criteria B, the PIN count pauses once either ROBOT has moved 2ft from where
 *    the PIN initiated until the PIN ends or until both ROBOTS move back within 2ft., at which
 *    point the PIN count is resumed.
 *    Violation: MINOR FOUL and an additional MINOR FOUL for every 3 seconds in which the
 *    situation is not corrected."
 *
 * Note what is NOT in it: any speed threshold, any requirement that the pinned ROBOT be against
 * a wall, and any escalation to a MAJOR. The sim had all three.
 */
export const PIN_SECONDS = 3;
/** "2 ft. (~61 cm)" — the separation in criterion A and the displacement in criterion B. */
export const PIN_ESCAPE_DIST = 24; // in
/** The pinned robot counts as "prevented from moving" while it is not gaining
 * ground AWAY from the pinner faster than this.
 *
 * Deliberately measured along the ESCAPE direction rather than as raw speed: a
 * robot being bulldozed sideways along a wall is moving fast and is still just as
 * pinned, and pausing the 3-count every time it slid was one reason real pins
 * almost never reached the threshold. */
export const PIN_STUCK_SPEED = 8; // in/s
/**
 * The PINNED robot must be trapped against a SOLID with the pinner on the open-field side: its
 * leading corner (straight away from the pinner) sits within this slop of the perimeter, a goal
 * wedge or a classifier channel.
 *
 * THE RULE DOES NOT REQUIRE THIS — a FIELD element is offered as an EXAMPLE of transitive
 * contact ("such as"), and direct contact alone can pin. It is kept because it is what breaks
 * the SYMMETRY of a shove: without something behind one of them, both robots are equally "in
 * contact, attempting to move, and going nowhere", and the sim has no referee to look at.
 *
 * It costs less than it looks. A pin with nothing behind the victim is a pin the victim is
 * being pushed ACROSS the field, and criterion B ends that as soon as either robot is 2 ft from
 * where it started — so the only open-field pin the rule would sustain is a stationary
 * stalemate, and a stationary stalemate is mutual, which criterion C ends anyway. What is left
 * uncovered is narrow: a robot wedged on another robot with open field behind it.
 */
export const PIN_WALL_SLOP = 3; // in
/**
 * How closely the pinner must lie along the direction the victim is TRYING to go, as a cosine.
 *
 * "Preventing the movement" means the pinner is in the way. Without this the sim fouled a robot
 * for standing behind an opponent who was driving itself into a wall under its own power — every
 * clause was satisfied (contact, attempting to move, going nowhere, trapped) and the opponent was
 * preventing nothing. Measured, the WEAKEST legal build "pinned" a default chassis that way.
 *
 * 0.34 is about 70 degrees either side: wide enough that a pinner does not fall out of it as the
 * pair rocks or as the victim saws at the stick, tight enough that somebody behind you while you
 * drive forwards is not pinning you.
 */
/**
 * How much a pinned robot may be driving INTO the thing it is trapped against before it stops
 * counting as trying to escape. `cos` of the angle between its commanded direction and the way
 * it is being shoved: +1 is straight into the trap, 0 is sideways along it, -1 is back through
 * the pinner. At 0.34 (~70°) a sideways or diagonal exit is an escape attempt and only a robot
 * pressing itself in is excluded.
 *
 * This REPLACED `PIN_OBSTRUCT_COS`, which asked the mirrored question — whether the PINNER lay
 * along the escape — and so ruled out every sideways exit, i.e. the ordinary wall pin.
 */
export const PIN_INTO_TRAP_COS = 0.34;
/**
 * How squarely the PINNER must be driving into its victim for an IDLE victim to count as
 * pinned — `cos` of the angle between the pinner's commanded direction and the line to the
 * victim. 0.34 is the same ~70° cone as `PIN_INTO_TRAP_COS`.
 *
 * Only consulted when the victim is asking to go nowhere. A victim held against a wall stops
 * working the stick long before they stop being held, so requiring a live escape command is
 * what made this foul rare — but with that requirement gone, something has to keep an
 * incidental lean off the foul sheet, and `rrContacts` is recorded on overlap alone. This is
 * that something: touching is not pinning, driving into someone is.
 */
export const PIN_PRESS_COS = 0.34;
/**
 * "for more than 3 seconds" — how long criterion A or B must hold before the PIN is over.
 *
 * This replaces a 0.6 s lapse timer that ended a pin the moment the hold flickered for any
 * reason at all. The rule is far narrower and far more patient than that: only DISTANCE ends a
 * pin, and only after three full seconds of it. Everything else — the bumpers unloading for a
 * tick, the victim's stick crossing the dead zone, the wall probe slipping past its slop as the
 * pair rocks — merely PAUSES the count, which is exactly the flicker tolerance the 0.6 s timer
 * was reaching for, except that a pinner can no longer wipe a two-and-a-half-second count by
 * easing off for seven tenths of a second.
 */
export const PIN_END_S = 3; // == HOPPER_CAPACITY
/** contact tolerance for CONTROL — a loose artifact counts only when its surface is
 * within this many inches of the robot's footprint (or of an artifact already
 * controlled, since the manual's CONTROL is transitive through scoring elements).
 * A touch tolerance, not a catchment radius. */
export const POSSESSION_CONTROL_MARGIN = 0.4; // in
/**
 * How hard the robot has to be driving INTO an artifact, along the outward normal of the face
 * it is touching, to be "moving the SCORING ELEMENT in a preferred direction" (CONTROL clause
 * B). Measured with `robotPointVelocity`, so the ω×r term is in it and a robot TURNING a
 * corralled pile is moving it too.
 *
 * This replaced two ABSOLUTE-SPEED gates — POSSESSION_MOVE_SPEED (the robot moving at all,
 * 1.5 in/s) and POSSESSION_TURN_RATE (0.15 rad/s) — which came from an FRC POSSESSION
 * definition that is not in the DECODE manual. There is no speed floor anywhere in DECODE's
 * CONTROL, and those floors were exploitable from both ends: a six-artifact pile CREPT below
 * 1.5 in/s drew nothing over twelve seconds, while a pile jammed against the perimeter read as
 * uncontrolled precisely BECAUSE it could not move.
 *
 * It sits low on purpose. It is not a threshold for "is this a violation" — that is what the
 * confirm window and the station test decide — it is only there so numerical noise in a
 * resting contact cannot read as a push. Anything a driver would recognise as leaning on an
 * artifact clears it.
 */
export const POSSESSION_PUSH_MIN = 0.5; // in/s, along the contact normal
/**
 * ...and how fast the ARTIFACT has to still be going, along the direction it is being taken,
 * for the robot to count as still MOVING it rather than just leaning on it.
 *
 * An arrival is not a journey. Without this the hold latched on the way in and never released:
 * shoving two artifacts against a wall billed once for the push, which is fair, and then again
 * every POSSESSION_REBILL_S for as long as you stayed there, while nothing moved at all.
 *
 * It sits at the artifact's own rest threshold, so it separates "going somewhere" from
 * "stopped" rather than fast from slow — a load crept downfield still counts.
 */
export const POSSESSION_MOVE_MIN = 2; // in/s — keep == BALL_REST_SPEED
/**
 * ...and how far the ARTIFACT has to have actually TRAVELLED, from where this robot first got
 * hold of it, before the robot counts as MOVING it.
 *
 * Clause B is "the ROBOT is MOVING the SCORING ELEMENT in a preferred direction", and the verb
 * is about the artifact, not the wheels. Pressing on something that is going nowhere is not
 * moving it — which is the whole difference between herding a pile and running into one:
 *
 *   · a pile ALREADY resting on the perimeter cannot go anywhere, so driving into it is
 *     contact and nothing else. G408 names exactly this: "bulldozing (INADVERTENT contact with
 *     a SCORING ELEMENT while in the path of the ROBOT moving about the FIELD)";
 *   · nor can a clump you have nosed into far enough to jam. Both were reported — "if you drive
 *     into a pile to intake you get a penalty if you go in too far" and "you get a penalty if
 *     you drive into five balls that are ALREADY at the wall."
 *
 * IT HAS TO BE DISTANCE, NOT SPEED. An instantaneous-speed floor was tried first and does not
 * work, because artifacts do not RIDE a bumper in this sim — they bounce off it and are
 * re-struck, so contact is a train of micro-impacts and a pile jammed on a wall reads as moving
 * quickly while going nowhere at all. Measured, a speed floor at the ball's own rest threshold
 * still billed 6 MINORs for driving into five artifacts that were already on the wall. Net
 * displacement is immune: jitter cancels, travel accumulates.
 *
 * ONE BALL DIAMETER is the threshold because it is the one distance in the game that explains
 * itself — the artifact is no longer where you found it, by its own width. Compression and
 * squirt as a pile settles are well under it; anything you could call herding is well over.
 *
 * This gates ACQUIRING control only. Once herding IS established the latch holds it through a
 * jam, so driving a pile INTO the wall and leaning on it still counts — those artifacts
 * travelled on the way there. That split is the whole of the leniency: running into things is
 * free, taking them somewhere is not.
 *
 * The distance is CUMULATIVE and STICKY: it survives the artifact re-stationing on the chassis
 * and survives its hold clock dying, because ground already covered does not un-happen and
 * because a clump in open space is pushed in a series of bounces rather than one continuous
 * shove. It is cleared only when the artifact stops being a loose ground ball, or outside
 * auto/teleop.
 */
/**
 * HOW FAST THE ROBOT HAS TO BE PUSHING for herding to count at all (in/s, at the contact).
 *
 * The LENIENCY knob, and an owner setting. `POSSESSION_CARRY_DIST` asks whether the artifacts
 * WENT anywhere; this asks whether the robot was really bulldozing when they did. Both have to
 * be true, so it can only ever make the rule kinder — which is the point.
 *
 * Why a velocity term came back at all: the engine had NO leniency gradient. Measured on a
 * 6-artifact row herded in open space for 10 s, a full hopper drew 6 MINORs and a YELLOW CARD
 * at EVERY throttle from 0.08 to 1.0, and a single loose artifact nudged gently drew 3. A
 * feather touch was billed the same as a full-throttle ram, which is not a rule anybody can
 * play around.
 *
 * ⚠️ IT IS THE INSTANTANEOUS PUSH SPEED, NOT A MEAN, and that distinction is the whole
 * reason this works where the old `POSSESSION_MOVE_SPEED` failed. Measured, the MEAN robot
 * speed does not merely fail to separate the cases, it INVERTS them: 7.5 in/s for a gentle
 * two-artifact nudge against 5.0 in/s for the nine-row ram that must foul, because the ram
 * spends most of its time stalled against the pile. The speed AT THE CONTACT, while touching,
 * separates them 5.6x — 11.0 in/s nudging against 61.6 in/s ramming. So the gate reads
 * `contactPush`'s own `speed`, which is `robotPointVelocity` at the contact point and already
 * carries the omega-cross-r term, so a corralled pile swung on the spot still counts.
 *
 * 22 sits between the two measured populations with room either side. Raise it for more
 * leniency; the rule goes quiet entirely somewhere above ~60, where even the ram stops
 * qualifying. Distinct from `POSSESSION_PUSH_MIN`, which stays at its own job of keeping
 * numerical noise in a resting contact from reading as a push.
 */
export const POSSESSION_HERD_SPEED = 22; // in/s at the contact point

export const POSSESSION_CARRY_DIST = 5; // in — one artifact diameter, carried in the push direction
/**
 * How far an artifact may WANDER, in the robot's own frame, and still count as remaining
 * "in approximately the same position relative to the ROBOT" — the glossary's test, applied
 * to the thing it actually talks about: POSITION.
 *
 * This replaced a velocity test (the artifact's speed against the robot's rigid-body
 * velocity at that point). Velocity reads possession only while an artifact is TRAPPED: a
 * clump shoved across open floor bounces and shuffles constantly, so no instantaneous match
 * ever holds, and the rule stayed silent until the pile was pinned against a wall and forced
 * to move at exactly the robot's speed. Reported as exactly that — "I don't get the
 * penalty until I push the clump all the way to the wall."
 *
 * Position is immune to that. An artifact being herded sits in front of the bumper the whole
 * way, however much it rattles; one you drive PAST sweeps the length of the chassis and is
 * gone; one that DEFLECTS leaves immediately. 8 in is about half a chassis width — room to
 * shuffle within the pile, not to travel across it.
 */
export const POSSESSION_DRIFT = 8; // s
/**
 * ...and how fast that clock DRAINS while control is back within the limit, as a fraction
 * of real time. This is the difference between a clock that accumulates and one that resets,
 * and it is load-bearing.
 *
 * A reset clock is trivially defeated by FLICKING: bump the pile, back off, bump again. Each
 * contact is well under the grace, so the clock never got anywhere — and measured in the sim,
 * a flick-shuttle moved a six-artifact pile FURTHER than a sustained shove did (18" vs 9")
 * while drawing zero fouls, where the shove drew three and a card. A penalty that the evasive
 * version of the same act dodges is worse than no penalty: it does not deter the behaviour,
 * it just selects for the technique.
 *
 * 0.5 -> 0.1, because AN INTERRUPTION IS NOT A RELEASE. Reported as "right now I need to be
 * controlling them for a long time for it to actually give me pens" — and the thresholds were
 * not the problem. Swept individually, the carry distance, the confirm window, the grace, the
 * progress floor and even a separate gentler drain for stalling all left the time-to-foul
 * within a tenth of a second of where it started; the floor there is set by the BULLDOZING
 * carve-out, since below about a second clipping an artifact in passing starts to foul.
 *
 * What actually costs a driver is that real herding is INTERRUPTED — you nudge, you turn, you
 * clip a corner — and at 0.5 each of those breaks ate back twice what the next contact put in,
 * so a push that was not clean from start to finish never converged at all. Measured, a slow
 * STEERED herd went from NEVER fouling to fouling at 2.98 s.
 *
 * It still drains: a genuine pass through a clump lets go, just over a few seconds rather than
 * a fraction of one, and every bulldozing and deflecting case in smoke is unchanged at 0.1.
 */
export const POSSESSION_LEAK = 0.1;
/**
 * How long ONE artifact has to stay with a robot before it counts toward the limit.
 *
 * This is the test that separates the two things a single frame cannot: HERDING (the same
 * artifacts, held or repeatedly re-struck) from BULLDOZING — "inadvertent contact with a
 * SCORING ELEMENT while in the path of the ROBOT moving about the FIELD", which G408
 * explicitly excuses. Crossing a littered field touches a dozen artifacts for a fifth of a
 * second each and none of them ever confirms; shoving a pile holds the same six for as long
 * as you shove; flicking re-strikes the same six every cycle, and because each artifact's
 * clock is LEAKY rather than resetting, those repeated touches add up on the artifacts
 * themselves. Identity is the signal — which artifacts, not how many.
 *
 * TOTAL TIME-TO-FOUL IS WHAT MATTERS, and it is this plus POSSESSION_GRACE plus however long
 * POSSESSION_CARRY_DIST takes to cover. Reported as "I still almost never get penalties" while
 * pushing about ten artifacts around — and measured, that push DID foul, but not until 1.43 s
 * of UNINTERRUPTED herding, which real driving (nudge, turn, adjust) rarely sustains. Trimmed
 * 0.65 -> 0.45 alongside GRACE 0.4 -> 0.2, taking the whole pipeline to 1.05 s with every
 * false-positive case still clean. It cannot go much lower: at GRACE 0.1 the bulldozing
 * carve-out breaks (clipping an artifact in passing starts to foul).
 *
 * This and POSSESSION_CARRY_DIST together are what make the rule LENIENT about running into
 * things. At 0.35 a robot nosing into a clump with its intake held was
 * fouled once it went in deep enough to jam: contact plus a fifth of a second is not enough to
 * tell "taking these somewhere" from "arriving among them". Swept against the full G408 case
 * matrix, 0.65 with a 5 in carry is the window where every case lands — below it the intake
 * cases foul, above it real herding starts slipping through.
 */
export const POSSESSION_CONFIRM = 0.45; // s, per artifact
/**
 * How long an artifact may sit in a RUNNING intake's mouth before it stops counting as
 * "being acquired" and starts counting as being PLOUGHED.
 *
 * The acquire carve-out is the manual's ("inadvertent contact ... while attempting to
 * acquire a SCORING ELEMENT") and it is real, but it used to be bounded by HOPPER ROOM,
 * which is the wrong axis entirely. An empty robot excused HOPPER_CAPACITY artifacts, and
 * a clump you would actually push around is 3-6 — so with the intake held, which is what a
 * driver does, ploughing one across open floor drew NOTHING at any size:
 *
 *     clump of   3   4   5   6   8
 *     intake ON  0   0   2   0   0
 *     intake off 0   1   6   5   7
 *
 * Time is the axis that separates the cases, because it is what "transporting" actually
 * means. An intake takes what is in its mouth in well under a second, so:
 *   · nose in, collect, back off  — contact is brief, excused, no foul;
 *   · clip a clump in passing     — briefer still, no foul;
 *   · push it across the field    — contact runs for seconds, and past this it counts.
 * Hopper room does not enter into it: a full robot ploughs exactly as hard as an empty one.
 */
// 0.4 -> 1.0: the window has to cover a real APPROACH, not just the swallow. A driver noses
// into a clump, the artifacts take a moment to reach the rollers, and the first one is in the
// hopper about a second later — measured, a 1.2s nose-and-back-off was fouling at 0.4. What it
// must NOT cover is herding, which runs for seconds, so a second is the honest split.
export const POSSESSION_ACQUIRE_S = 1.0; // s

// ------------------------------------------------------------ artifacts ----
export const BALL_RADIUS = 2.5; // 5 in diameter
/**
 * ROLLING RESISTANCE WITH THE FLOOR (in/s^2), and the thing that decides how far a shoved
 * artifact travels.
 *
 * A robot driving a line of artifacts pushes them at its own speed, and the one at the end of
 * the chain is handed `(1 + BALL_BALL_RESTITUTION) / 2` of that — measured 67 in/s off a robot
 * doing 81, which is the textbook equal-mass answer and not an error anywhere in the solve. So
 * how far it then travels is the ONLY thing this behaviour depends on, and at 20 it coasted
 * 112in across a 144in field: "the third one bounces out far away, hits the other field wall,
 * comes back and gets grabbed".
 *
 * MEASURED CURVE — the punt (a line of three with 71in of floor past it, driver lets go after
 * two) against the gate drain reaching the human-player corner:
 *
 *     in/s^2 |  g     | punt runs | touches the far wall | drain to the corner
 *        20  | 0.052  |  67-68in  |      5 of 6          |      9 of 9
 *        28  | 0.073  |     68in  |      3 of 3          |      8 of 9
 *        32  | 0.083  |  61-68in  |      4 of 6          |      7 of 9
 *        40  | 0.104  |  49-66in  |      0 of 6          |      4 of 9
 *
 * 40 is the only value that contains the punt, and it also restores the "~4-5 of 9" this
 * comment always claimed the drain did. It was REJECTED anyway: a pile leaned on a wall can no
 * longer squirt free, so it creeps and G408 re-bills it (2 extra MINORs over 6.5s of just
 * holding, the reported "I get penalties when I'm pushing forward against two balls against the
 * wall"), and a line of six handed an artifact 1.11x the pushing robot's own speed.
 *
 * 28 is an owner setting: 0.073g against 0.052g at 20, still inside the 0.05-0.15g a foam ball
 * on field tile plausibly has, and it keeps the drain nearly intact. It does NOT contain the
 * punt — that needs 40 and the penalty cost above. 32 is the middle if the punt matters more.
 *
 * The clump push-drag (`BALL_PUSH_DRAG`) still carries the harder-to-push feel.
 */
export const BALL_ROLL_FRICTION = 28;
export const BALL_REST_SPEED = 2; // in/s, snap to rest below this
/**
 * The most a ground artifact ever moves at (in/s), applied to what the artifact solve hands
 * back. A squeeze between a chassis and a wall a few degrees off square asks the ball to travel
 * many times the robot's own advance to stay clear, and the solver obliges with whatever speed
 * the constraints demand — 300 in/s and more — which is both faster than a foam ball pops out
 * of anything and further per tick than the solve's look-ahead (`PHYS_BALL_PREDICTION`), so
 * the next tick could not see it coming: a 5in artifact went through a 2.7in corner gap. An
 * inch and a half a tick keeps every contact in view, and nothing on this field moves faster than
 * a chassis at full speed — a foam ball squeezed out from under one deforms rather than
 * outrunning it (at 120 a wall pile rammed at full throttle flung artifacts 120in across the
 * field).
 */
export const BALL_MAX_SPEED = 90;
export const BALL_WALL_RESTITUTION = 0.5;
export const BALL_BALL_RESTITUTION = 0.68; // horizontal speed kept on ground bounce
export const GRAVITY = 386;

/**
 * How much overlap with a chassis an artifact may end a tick with before it is treated as
 * JAMMED rather than merely in contact. Rapier's soft contacts leave about 0.2in, so this sits
 * clear of that and well under the ~1in of give the squeeze was exploiting.
 */

export const BALL_ROBOT_RESTITUTION = 0.05;
/** ground-ball mass (lb) for the Rapier ball solve (`solveArtifacts`). Balls only
 * meet other balls (equal mass ⇒ value cancels) and the immovable static field
 * there — ball↔robot is the bespoke `collideBallRobot` pass, NOT Rapier, because
 * the pin stall + "outflow can't shove a parked robot" feel (product decision #7)
 * is deliberately non-physical. So this is essentially a numerical scale; a light
 * foam-ball value is kept for physical honesty. Ball restitution combines with
 * `CoefficientCombineRule.Min`, so ball↔static = min(BALL_BALL_RESTITUTION,
 * BALL_WALL_RESTITUTION) = BALL_WALL_RESTITUTION and ball↔ball = BALL_BALL_REST. */
export const BALL_MASS = 0.2;

// ------------------------------------------------- robot contact torque ----
/** per-tick angular correction cap from a single contact group (rad), at rest */
export const CONTACT_ALIGN_RATE = 0.03;
/**
 * How much deeper than its neighbours a contact must be before the neighbour stops bearing —
 * the bumper's compliance, in inches of squash.
 *
 * The load at each corner is shared by how far it is compressed, and this is the distance over
 * which that share falls to nothing. It replaces a flat bias floor, which handed load
 * to corners that were not touching at all: with two front corners whose lever arms differ
 * (the intake extends the front, so they are not mirror images), that fabricated vote can
 * outweigh the real contact and reverse the torque — "it's turning me the other way sometimes".
 */
export const CONTACT_COMPLIANCE = 0.5; // in
/** alignment speedup per in/s the robot pushes into the contact — holding
 * forward against a wall turns briskly, a fast hit swings hard */
export const CONTACT_PRESS_GAIN = 0.4;
/** hard cap on per-tick alignment under pressure (rad) */
/**
 * ...AND THE CEILING THAT GAIN CAN REACH. A contact must not out-turn the drivetrain.
 *
 * It was 0.12 rad — 6.9 degrees in ONE TICK, 412 deg/s — so a firm press quadrupled the base
 * rate into a snap: "it spins me around like 90 degrees instantly", "way too fast". At 0.05 the
 * worst single tick ramming a wall at speed is 2.9 degrees (174 deg/s), which is about what a
 * robot can turn itself, and a 20-degree tilt still comes flush in well under a second.
 */
/**
 * ...AND LOWER STILL, NOW THAT RAPIER OWNS THE IMPACT. The bodies rotate in the solve, so an
 * angled ram squares itself up there — measured, every wall ram lands within 0.1° of flush with
 * this term switched off entirely. What the align is FOR is the case the solver leaves alone:
 * a chassis LEANING on a face at an angle under a sustained press (a pinned robot, a robot
 * driven into a corner, Chain Reaction's wall approach), where friction holds the tilt. That
 * is a slow settle, and at 0.05 rad/tick the term was also adding 2.9° a tick ON TOP of the
 * solver's own 2.4° during a ram — the "snaps the chassis round" report. 0.015 brings a 20°
 * lean flush in under half a second and adds under a degree a tick to anything.
 */
export const CONTACT_ALIGN_RATE_MAX = 0.015;
/** spin injected per (contact torque × in/s of impact speed) — a fast angled
 * hit visibly converts momentum into rotation; dead-center hits add nothing */
/**
 * ...and the FLICK a fast angled hit adds on top, as angular velocity.
 *
 * Unlike the alignment this is not capped at the remaining tilt — it keeps turning the chassis
 * after the contact has done its work, which is what a violent hit should do and also what
 * makes a merely firm one feel violent. Halved and more with the align ceiling: ramming a wall
 * at speed peaked at 3.23 rad/s (185 deg/s of free spin) and now peaks at 0.80.
 */
/**
 * ZERO: the solver owns the impact. The bodies rotate in the robot solve, so a fast angled hit
 * converts momentum into rotation there, from the real normal and friction impulses at the real
 * corner — and adding a flick on top counted the same hit twice (measured 3.5 rad/s against the
 * solver's own 2.6 on a 20° wall ram at full speed, which is v·sin20°/half-diagonal: the pivot
 * about the corner). Kept as a named zero so the settling path's shape stays readable.
 */
export const CONTACT_IMPACT_SPIN = 0;
/**
 * How close a second separating axis has to be to the least-overlapping one before it counts
 * toward the contact normal, in inches of overlap.
 *
 * SAT returns one axis, which is right in the middle of a face and ill-conditioned at a
 * CORNER — there two axes are within noise of each other and the normal flips between them as
 * the shapes slide a hair. The true normal at a corner is between the two faces that meet
 * there, so axes within this window are blended by how close they are to being the answer.
 * A quarter inch is about the depth a bumper compresses, and well under the size of any
 * feature this is used on.
 */
export const CONTACT_NORMAL_BLEND = 0.25; // in
/** touch tolerance (in) for the post-Rapier square-up pass: Rapier resolves
 * translation and leaves a chassis resting AT a face (near-zero penetration),
 * so the bespoke torque nudge treats a contact within this band as touching */
export const CONTACT_TOUCH_EPS = 0.5;
/** Rapier length scale: the world is in INCHES, not meters. Rapier scales its
 * internal penetration/prediction tolerances by this so contacts resolve firmly
 * at our scale (a typical object — robot/ball — is ~10 in). */
export const PHYS_LENGTH_UNIT = 10;
/** Rapier constraint solver iterations per step — high enough that a full-speed
 * pin is fully separated each tick (no penetration accumulation / axis flip) */
export const PHYS_SOLVER_ITERS = 8;
/**
 * Rapier contact stiffness (Hz) for the ROBOT world, and the slack it resolves to.
 *
 * These were 8 Hz / 0.01 on the reasoning that SOFT contacts let a body starting deep inside
 * a wall (a spec change can grow the footprint under a parked robot) bleed out gently instead
 * of being ejected with a huge recovery velocity. The gentleness is real and worth keeping —
 * but 8 Hz was paying far more for it than the hazard costs. Measured, a max-push tank
 * holding an opponent against the wall sank the victim 1.22in into the wall and 1.50in into
 * itself: ~9% of a chassis, and visible.
 *
 * SWEPT, rather than argued about. Across 8/15/20/25/30/40/60 Hz the recovery velocity from
 * BOTH hazard cases — a robot seeded 2in inside the wall, and two robots seeded 6in
 * overlapped — came out at 0.0 in/s at every single setting, because Rapier's positional
 * correction here does not feed velocity. There is no explosion to buy off. What the sweep
 * did show is where the penetration stops improving: 1.22in at 8 Hz, 0.59 at 12, 0.55 at 15,
 * 0.49 at 25, and then it creeps back up past 30.
 *
 * 12 Hz, NOT the 25 the penetration curve would pick, and the slack is UNCHANGED. Everything
 * above 12 cost something else: 15 Hz broke the classifier-jitter ratchet, and 25 Hz also
 * broke two G408 possession checks and the wall-ram torque bound. 12 is the largest step with
 * no collateral, and it is worth roughly half the remaining penetration.
 *
 * THE ITERATION COUNT IS NOT A LEVER HERE. `PHYS_SOLVER_ITERS` is shared with the BALL world
 * (`makeWorld` parameterises the frequency and the slack but not the iterations), so raising
 * it moved artifact behaviour that has nothing to do with robots pushing each other.
 */
export const PHYS_CONTACT_FREQ = 12;
/** normalized allowed penetration error (× lengthUnit ⇒ inches): a little slack
 * so shallow resting contacts aren't fought every tick */
export const PHYS_ALLOWED_ERROR = 0.01;
/**
 * Post-solve speed ceiling for a robot, in in/s. A pure solver-explosion guard — see
 * `solveRobots`.
 *
 * ABSOLUTE, NOT A MULTIPLE OF THE ROBOT'S OWN TOP SPEED. It was `maxSpeed × 2`, which sounds
 * safer and is not: what sets a shoved robot's velocity is the PUSHER's speed, not its own, and
 * the legal envelope runs from 30.1 in/s (x-drive, 18 lb, 200 rpm) to 120.9 (tank, 560 rpm) —
 * so the slowest legal build's ceiling sat at 60.3, well BELOW what the fastest legal build can
 * legitimately shove it to. Measured, it fired on 27 of 65 ticks of a plain open-field push
 * with no wall and nothing over-constrained, throttling the push 12% and putting a
 * discontinuity in the rpm slider that has no physical cause.
 *
 * 300 in/s is ~2.5× the fastest thing that can exist here, so nothing a robot can do to another
 * robot reaches it, while the one genuinely over-constrained case still does: a chassis crushed
 * between a wall and an auto-path robot (kinematic, and it does not yield) left the step at
 * 959 in/s — six field widths a second — before this clamp.
 */
/**
 * The angular twin of `PHYS_MAX_ROBOT_SPEED`, in rad/s: a SOLVER-EXPLOSION GUARD, not a
 * gameplay lever. Every drivetrain's own `maxTurn` is under 11 rad/s and the hardest legal
 * hit adds a couple more, so this is several times anything the game can produce — a body
 * past it is an over-constrained contact, not a shove anybody felt. Absolute, for the same
 * reason the speed guard is: what spins a slow chassis is the OTHER robot's authority.
 */
export const PHYS_MAX_ROBOT_SPIN = 25;
export const PHYS_MAX_ROBOT_SPEED = 300;
/**
 * How far a robot's footprint may sit outside the field before it is walked back in.
 *
 * The perimeter is a hard containment invariant for robots, the same way `clampBallPosToStatics`
 * is for artifacts — and it was only ever enforced by the solver, which is not enough now that a
 * robot on an AUTO PATH is a kinematic body that does not yield: a bystander crushed between one
 * and the far wall was driven 15.2in past it, with its reported velocity reading 0.00 the whole
 * time (Rapier's positional correction does not feed velocity), so no speed guard can see it.
 *
 * The slop matters. Ordinary soft contact leaves a chassis resting a little INTO a wall — 0.59in
 * at the worst measured shove — and a containment pass that fought that every tick is exactly
 * the two-passes-taking-turns failure the artifact solve had to be rebuilt to avoid. This sits
 * above the worst honest penetration and far below "outside the field", so it only ever acts
 * when the solver has already given up.
 */
export const PHYS_CONTAIN_SLOP = 0.75; // in
/**
 * Friction on the ROBOT and BALL colliders — resists a pinned robot sliding out of a squeeze
 * (the old model squared-and-held; 0 let it squirt).
 *
 * ⚠️ NOT the field walls, despite what this comment used to say. `statics()` never called
 * `setFriction`, so every wall, goal face and classifier ran on Rapier's DEFAULT instead — and
 * since the default combine rule is AVERAGE, robot-on-wall was silently (0.7 + 0.5) / 2 = 0.6
 * while robot-on-robot was 0.7. That is not unreasonable (a bumper on a smooth field wall
 * should slip more easily than on another bumper) but nothing chose it, so it is stated below
 * rather than inherited. Found while measuring why a robot held against a wall could not
 * strafe out; it is not the cause — that is Coulomb stick/slip, and lowering this only moves
 * where the slip threshold falls — but a physics constant should not arrive by accident.
 */
/**
 * ...AND IT IS NOW THE BUMPER'S OWN NUMBER. 0.7 was chosen when the contact response was
 * hand-written and the post-solve lateral clip handed a refused strafe straight back to the
 * chassis, so nothing ever measured what this friction actually did to a held robot. With an
 * honest contact it decides whether a robot pinned against a wall can strafe out: the wall and
 * the pinner's bumper together hold it with (wall + bumper) times the pinner's push, against a
 * strafe worth its own push — and a stalled motor pushes with its whole stall force at any
 * throttle. At 0.7/0.5 an EQUAL robot could never get out (1.3× against 1×), which is not what a
 * fabric-covered bumper on polycarbonate does.
 *
 * 0.15 (owner's call, from 0.45): BUMPER ON BUMPER ONLY. Rapier derives a pair's friction from
 * the two colliders, so this one number sets robot↔robot AND, averaged with the static's,
 * robot↔wall — they cannot be moved independently from here. So `PHYS_WALL_FRICTION` absorbs
 * the difference and robot↔wall is held at the 0.40 it has always been. 0.15 is the floor:
 * at 0.10, with the wall still compensated to 0.40, a heavy tank holding a victim against the
 * wall bills 2 G422 over 20s instead of 6 and the rule stops being reachable.
 *
 * ⚠️ IT DOES NOT CONTROL WHETHER A PUSH CAN BE ESCAPED, which is the thing it reads as. Swept
 * from 0.45 down to 0.1, a victim cornered against the wall by a heavier robot travelled 14.9,
 * 15.0, 14.9, 14.9, 14.9in — flat to the tenth of an inch. The hold is the wall geometry and the
 * pusher's drive force; the bumper coefficient is not in it. What the sweep DOES move is
 * detection and the gate: at 0.15 a heavy tank holding a victim bills 4 G422 over 20s instead of
 * 6, and at 0.1 it bills 2 AND the gate arm stops turning a robot that hits it 8in off centre
 * (21deg to 0 — the bumper slides off the arm instead of being turned by it). 0.2 is the lowest
 * value that keeps both. The ARTIFACT world keeps its own values ().
 */
export const PHYS_FRICTION = 0.15;
/**
 * Friction on the STATIC field colliders: walls, goal faces, classifier, AND the gate arms
 * (they go through the same `statics()` helper, which is why dropping the robot's own value
 * alone stopped the arm turning a robot that hit it off centre — 21deg to 0).
 *
 * ⚠️ THIS IS NOT THE WALL'S COEFFICIENT, IT IS A COMPENSATOR. Neither collider names a combine
 * rule, so Rapier AVERAGES the pair, and the robot's own `PHYS_FRICTION` is therefore half of
 * robot↔wall as well as all of robot↔robot. To lower bumper-on-bumper without touching
 * bumper-on-wall, this absorbs the difference: `(PHYS_FRICTION + this) / 2` is held at the
 * 0.40 robot↔wall has always been, so this reads high on purpose. Move one, recompute the
 * other. (An earlier comment here claimed 0.6 — that was the average of the old 0.7/0.5 pair
 * and outlived them — and claimed this was Rapier's own default, which is 0.5, not either.)
 */
export const PHYS_WALL_FRICTION = 0.65;
/**
 * IN-PLANE friction on an artifact — ball on ball, ball on bumper (`PHYS_BALL_FRICTION`) and
 * ball on the field (`PHYS_BALL_WALL_FRICTION`) — and it is NEARLY ZERO on purpose.
 *
 * The artifact bodies are rotation-locked circles in a top-down plane, so a tangential friction
 * impulse has nowhere to go but the ball's TRANSLATION. On a real rolling sphere it goes into
 * spin about the vertical axis, which the floor lets go of almost for free: a ball grazing
 * another ball, or rolling along a wall, or sliding across a bumper face, is spun, not dragged.
 * At the old 0.7/0.5 a glancing hit sent the struck ball off at 3 degrees where the contact
 * normal was at 30, a 45-degree wall bounce kept a quarter of its along-wall speed, and 70% of
 * the moving contacts in a gate drain were pairs travelling together — "artifacts feel stuck
 * to each other and to the wall". At 0.05 the same hits leave along the normal, the bounce
 * keeps its tangential speed, and the drain disperses. Rolling resistance with the FLOOR is a
 * separate thing (`BALL_ROLL_FRICTION`) and is untouched.
 *
 * ZERO, not small. At 0.05 a ball squeezed between a bumper and a wall a few degrees off square
 * squirted out along the wall at 165 in/s for one tick and then stopped dead: the solver's
 * penetration recovery puts an enormous normal impulse into a squeezed contact, and even a
 * twentieth of that as friction cancelled the whole sideways speed — a friction cone wrapped
 * round a ball that in reality would ROLL out. A rolling sphere has no in-plane friction cone.
 */
export const PHYS_BALL_FRICTION = 0;
export const PHYS_BALL_WALL_FRICTION = 0;
/** BALL contact stiffness (Hz) for the ball solve — stiffer than the robot world
 * (12 Hz), which let two grounded balls sit visibly overlapping for many ticks.
 * Tuned to 25: separates a resting overlapping clump within ~0.5s (as clean as a
 * much higher value) WITHOUT the explosive ejection a very stiff contact (≥60 Hz)
 * gives the tightly-packed column draining out of the gate — at 120 Hz those exit
 * balls shot out at ~2× their intended speed. 25 keeps gate outflow at the natural
 * exit velocity while still killing resting overlap. */
export const PHYS_BALL_CONTACT_FREQ = 25;
/** BALL allowed penetration (× lengthUnit ⇒ inches): tight, so resting balls
 * settle touching rather than at the ~0.1in slop the robot value leaves. */
export const PHYS_BALL_ALLOWED_ERROR = 0.001;
/**
 * How far ahead the ARTIFACT solve looks for contacts (× lengthUnit ⇒ inches): the speculative
 * contact distance.
 *
 * Rapier's narrow phase runs once per step, so a pair that is not within this distance at the
 * START of the tick has no contact at all during it — the bodies pass into each other by
 * however far they travel, and the solver only finds out next tick and pushes them back out
 * at the contact stiffness's own pace. At the default 0.02in that is every fast contact on the
 * field: a chassis sweeps 1.5in a tick at full speed. A speculative contact instead lets the
 * solver stop a pair AT the surface — the constraint is "may close the gap this tick, may not
 * cross it" — which is what makes one pass enough, with nothing to clamp afterwards.
 *
 * Sized for the fastest closing pair the field has: a chassis at its top speed plus an
 * artifact rolling toward it, comfortably under 3.5in a tick.
 *
 * ⚠️ RAPIER APPLIES NO RESTITUTION ON A SPECULATIVE CONTACT. The gap is closed as a velocity
 * clip and the bounce is computed from whatever approach is left, so with this look-ahead every
 * ball-ball and ball-wall hit landed at ~0.14 for a set 0.68 and 0.5 — measured at every speed,
 * stiffer contacts making it worse (0.03), CCD changing nothing. The look-ahead was dropped to
 * Rapier's default for a day and the bounce came back exactly, but the contact of a pushed
 * artifact with the one AHEAD of it then formed a tick late, and a pile pushed by a chassis
 * became a tick-by-tick chain of burials (0.6in in the chassis, 1.7in ball in ball) that the pin
 * test had to be taught to ignore — and it could not tell a transient from a trap. So the
 * look-ahead stays, and the bounce of an IMPACT is computed before the solve, exactly, by
 * `bounceFirstContacts`: the solver's speculative contacts do what they are good at (a pushed
 * chain moving in one pass, nothing buried) and never see an impact they would have to bounce.
 */
export const PHYS_BALL_PREDICTION = 0.35;
/** friction of the intake's slopes, rails and held artifacts as a ground artifact sees them.
 *  They are guides and compliant wheels, not a brake: at the chassis's own 0.7 the funnel's
 *  pull along a slope was eaten by friction and a 7in-off-centre artifact took 1.3s to reach the
 *  throat against 0.33s. */
export const INTAKE_STRUCT_FRICTION = 0.05; // in
/**
 * Thickness of the vector intake's flank rails, the only thing solid forward of that
 * preset's chassis face at floor level. The rails keep a wide frame from being entered from
 * the side (see `artifactSolids.ts`); they sit just inside the notch with their outer face
 * flush with the chassis side, so the notch is narrower by this on each side.
 */
export const INTAKE_RAIL_T = 0.5; // in
/**
 * How far a funnel preset's slope face runs PAST the roller line (in) — the compliant end of
 * the roller row, which pulls in an artifact overlapping the mouth's edge instead of letting
 * it ride the corner. Sized so an artifact centred at the mouth's edge meets the face and one
 * a radius further out does not: the capture envelope is unchanged (in at 6in, out at 8in for
 * the sloped preset). See .
 */
export const INTAKE_LIP = 0.6; // in
// ---------------------------------------------------------------- robot ----
export const ROBOT_MAX_SIZE = 18;
/** the chassis may be narrower than the intake (easier base parking) */
export const ROBOT_MIN_WIDTH = 10;
/** SWERVE needs a wider base than the other drivetrains — four steering modules
 * at the corners don't fit a tiny frame — so its minimum width floors higher. */
export const SWERVE_MIN_WIDTH = 13.5;
/** wheel centers sit this far INSIDE the chassis edge (typical FTC build);
 * the four wheel ground-contact points are what counts for base parking */
export const WHEEL_INSET = 2.6;
// ============================================================================
// DRIVETRAIN & MOTOR BALANCE — TUNE HERE
// ----------------------------------------------------------------------------
// Grounded in real FTC hardware: a 104 mm goBILDA drive wheel + the MATRIX /
// goBILDA 5000-series 12VDC brushed motor (5800 rpm free, 20.45 oz-in / 9.2 A
// stall, 0.25 A free). A brushed DC motor has a LINEAR torque–speed curve, which
// is exactly the motorStep model below.
// The model (src/sim/drivetrain.ts + robot.ts):
//   1. BASE reference = an IDEAL traction wheel: free speed = wheel geometry
//      (WHEEL_DIAMETER_MM) × driveRpm × DRIVE_EFFICIENCY; BASE_DRIVE_ACCEL stall
//      accel. `driveRpm` is the WHEEL rpm (post-gearbox); the datum is "no roller
//      loss", i.e. what a traction wheel on this motor would do.
//   2. Each DRIVETRAIN_PRESET applies REAL efficiency FACTORS on top (all ≤ 1
//      except tank ≈ ideal): mecanum/x-drive rollers slip → less speed, accel,
//      and pushing; tank/swerve traction bites hard. See the table.
//   3. MOTORS follow the DC torque–speed curve (motorStep): full stall torque off
//      the line, falling ~linearly to zero at free speed, so velocity approaches
//      top speed asymptotically instead of a constant ramp.
//   4. Mass ↓ accel, RPM ↑ speed / ↓ accel (torque), power draw ↓ everything.
// To rebalance: edit the numbers here; `npm test` prints the resulting speed /
// strafe / accel / push table (driveSummary) so the effect is immediately visible.
// ============================================================================
export const REF_DRIVE_RPM = 435;
export const REF_MASS_LB = 26;
/** goBILDA 104 mm mecanum / traction drive wheel */
export const WHEEL_DIAMETER_MM = 104;
/** loaded drivetrain efficiency: a real motor never reaches free speed on the
 * field (gearbox + bearing + rolling losses), so the top speed it APPROACHES is
 * ~80% of the 104 mm free-speed geometry. Bump toward 1 for a floatier top end. */
export const DRIVE_EFFICIENCY = 0.95;
/** in/s of loaded top speed per WHEEL rpm = (π·104 mm → in / 60) · efficiency.
 * ≈ 0.204 → 435 wheel-rpm ≈ 89 in/s (7.4 ft/s), a real fast FTC drive. */
export const SPEED_PER_RPM = (Math.PI * (WHEEL_DIAMETER_MM / 25.4)) / 60 * DRIVE_EFFICIENCY;
/** in/s^2 PEAK accel at reference RPM/mass, TRACTION-limited (μ·g), NOT motor-
 * limited: the MATRIX motor's stall torque could give ~460 in/s² but the wheels
 * slip first, so real peak accel = μ·g (g≈386 in/s²). This base × accelMult lands
 * each drivetrain at its traction limit (tank μ≈0.9 → ~347 … x-drive μ≈0.45 → ~175). */
export const BASE_DRIVE_ACCEL = 240;
export const TURN_MAX_SPEED = 12.0; // rad/s absolute cap ≈ 687°/s (only small/fast bots reach it; default ~8.5)
export const TURN_ACCEL_PER_ACCEL = 40 / 280; // rad/s^2 per in/s^2 of drive accel (≈0.143; traction-limited, so
// turn spin-up tracks linear accel → tank ramps up quickest, xdrive slowest; ~0.15–0.25 s to max spin)

// --- motor torque–speed curve (how the stall accel falls off with speed) ---
/** 0 = old CONSTANT accel; 1 = physically real (force ∝ 1 − v/v_free). Higher =
 * punchier off the line, gentler approach to top speed (a real motor is 1.0). */
export const MOTOR_TORQUE_CURVE = 1.0;
/** floor on the torque fraction near free speed so a bot still closes the last
 * few % to top speed instead of crawling forever. */
export const MOTOR_MIN_TORQUE_FRAC = 0.06;
/** braking torque multiplier: reversing / slowing pulls harder than peak drive
 * accel (motor back-EMF + reverse), so stops feel crisp. */
export const MOTOR_BRAKE_MULT = 1.4;
/**
 * ...AND YOU CANNOT BRAKE AWAY SOMEBODY ELSE'S SHOVE, which is a different thing entirely.
 *
 * `MOTOR_BRAKE_MULT` is a robot stopping ITSELF: the driver lets go, the motors are driven
 * against the robot's own momentum, and 1.4x peak drive accel is the honest number for that.
 * Applied to a robot being PUSHED it says something else — that an unpowered chassis resists
 * an opponent HARDER than that opponent can drive — and it made pushing an idle robot nearly
 * impossible: measured on two identical tanks, three seconds of full throttle moved the
 * victim 15.5in, at 5.1 in/s against a 89 in/s free speed. Reported as "pushing another robot
 * when the other robot is not powered is super hard when it is usually not TOO hard".
 *
 * What actually resists there is back-EMF through a shorted motor plus rolling and gearbox
 * drag — the wheels ROLL, they are not held. So a robot with NO drive command that is in
 * contact with another robot brakes at this fraction instead. It is still real resistance
 * (about 0.6x drive accel, so a push is slow work) but the pusher gets somewhere.
 *
 * ⚠️ It applies ONLY to a robot commanding nothing AND touching another robot. A driver
 * actively driving back into a shove keeps full authority — a stalemate between two equal
 * chassis stays a stalemate — and solo driving is untouched, so stopping distance in ordinary
 * play is bit-for-bit what it was.
 */
export const MOTOR_SHOVE_BRAKE = 0.6;

// --- PUSHING POWER ----------------------------------------------------------
/**
 * GEARING'S EFFECT ON SHOVE, and the band it is allowed to act over.
 *
 * Wheel torque is inversely proportional to the gearing, so a drivetrain geared for speed
 * has less of it to put into a shove: the factor is `REF_DRIVE_RPM / driveRpm`, clamped so
 * neither end of the rpm slider becomes the whole game. Over the sliders' 200-600 range the
 * raw ratio runs 2.175 down to 0.725, and the clamp bites only at the torquey end.
 *
 * IT IS APPLIED EXACTLY ONCE. `driveParams().accel` already carries its own `REF_DRIVE_RPM /
 * rpm` term, and because the sim pushes by SETTING VELOCITY the delivered force is
 * `collider mass × that accel` — so a gearing factor baked into the collider mass landed a
 * SECOND time and the spread came out 7.45x instead of 2.48x, which made the rpm slider a
 * stronger pushing lever than the drivetrain pick (a 250 rpm minimum-weight mecanum
 * out-pushed a 42 lb 435 rpm tank). `shoveMass()` in drivetrain.ts is the one place that
 * divides the accel back out; do not re-introduce a gearing, mass, or power-draw term here
 * without checking whether `accel` already has it.
 */
export const PUSH_RPM_MIN = 0.6;
export const PUSH_RPM_MAX = 1.8;

/** SWERVE module steer rate (rad/s): how fast the four steered pods re-aim to a
 * new drive direction. With MODULE OPTIMIZATION (pod flip — see robot.ts) the pods
 * never rotate more than 90° (a bigger change flips the drive motor instead), so
 * ~7 ⇒ at most ~0.22 s to re-aim. The target angle is set immediately; the pods
 * just physically slew to it while the drive keeps running. This reorient LAG is
 * swerve's real cost vs mecanum's instant rollers — keep it felt (don't raise high). */
export const MODULE_SLEW_RATE = 7;
/** SWERVE control-loop imperfection: each of the four modules has its OWN steering
 * loop (always running) that can't perfectly HOLD its angle, so an INDEPENDENT,
 * FAST oscillating error is superimposed while driving. It's a SUM of a few
 * incommensurate sinusoids at per-module-varied frequencies (robot.ts) — an
 * IRREGULAR, non-periodic jitter, NOT a clean uniform sine — so each pod hunts on
 * its own. The errors don't cancel → the forward-kinematics of the mispointed pods
 * yields a small path DRIFT + net YAW jitter driving straight. Swerve's balancing
 * weakness (imprecise line), NOT weight. Disturbance ∝ actual SPEED, so at rest it's
 * zero and the pods converge to one angle. AMP = peak per-pod error (rad); FREQ =
 * the base jitter rate. Tune AMP for how imprecise, FREQ for how jittery. */
export const SWERVE_WOBBLE_AMP = 0.15; // rad (~8.6°) peak per module, at full speed
export const SWERVE_WOBBLE_FREQ = 30; // rad/s — the FAST jitter component (the buzz)
/** rad/s of the SLOW per-module drift component. Low enough that it does NOT
 * average out over a wall-to-wall run — the four modules meander independently,
 * so the net heading (yaw) wanders and the robot DRIFTS off a straight line
 * (fast jitter alone just buzzes and cancels). This is what makes swerve hard to
 * track straight. Raise the drift weight/amp for more veer. */
export const SWERVE_DRIFT_FREQ = 2.2;

/** per-drivetrain weight + RPM envelopes. Tank runs heavy with a torque-biased
 * (lower) RPM ceiling; swerve modules are complex → a raised mass floor and a
 * lower RPM ceiling; mecanum/x-drive get the full range. The MASS FLOOR is
 * further raised by flywheel inertia (a heavier flywheel — see massLimits). */
export const DRIVETRAIN_LIMITS = {
  mecanum: { minMass: 18, maxMass: 42, minRpm: 200, maxRpm: 600 },
  xdrive: { minMass: 18, maxMass: 42, minRpm: 200, maxRpm: 600 },
  tank: { minMass: 22, maxMass: 42, minRpm: 200, maxRpm: 560 },
  swerve: { minMass: 21.5, maxMass: 40, minRpm: 200, maxRpm: 500 }, // a touch heavier base (8 motors + modules)
  // BUTTERFLY carries BOTH wheel sets plus the lift, so its floor sits ABOVE tank's 22 —
  // the heaviest starting point in the game, and the literal cost of the archetype. The
  // rpm fields here are the MECANUM-set slider (the full 200-600 mecanum envelope); the
  // traction set has its own, torque-biased range in BUTTERFLY_TANK_RPM.
  butterfly: { minMass: 24, maxMass: 42, minRpm: 200, maxRpm: 600 },
} as const;

/** BUTTERFLY's TANK-set rpm envelope — the same torque-biased ceiling tank runs (560),
 * because it is the same kind of geared traction set. The mecanum set keeps the wider
 * range in `DRIVETRAIN_LIMITS.butterfly`. Two sets, two gearings, two sliders. */
export const BUTTERFLY_TANK_RPM = { min: 200, max: 560 } as const;
/** lb added to a drivetrain's mass floor at flywheelInertia 1 (a big flywheel
 * weighs more): effective floor = base + INERTIA_MASS_FLOOR·inertia. Kept small
 * so inertia only nudges the mass range. */
export const INERTIA_MASS_FLOOR = 4;

/** per-drivetrain REALISM factors + wheel-saturation model. Every factor is a
 * fraction of the ideal-traction BASE — tank ≈ 1 (traction bites), the roller
 * drives (mecanum/x-drive) pay real losses. Resulting free speeds at the 435-rpm
 * reference (base ~89 in/s): tank 89 · swerve 84 · mecanum 77 · x-drive 74; peak
 * accel (μ·g): tank 348 · swerve 317 · mecanum 211 · x-drive 175.
 * DRIVETRAIN NICHES: tank = raw power + no strafe; swerve = strongest holonomic
 * (speed/accel/push/full-strafe) BUT its imperfect pod control makes it WOBBLE
 * driving straight (imprecise line) + pods reorient on direction changes; mecanum =
 * the LIGHT, INSTANT, PRECISE holonomic (no wobble, zero reorient lag) but slower +
 * weak push; x-drive = deliberately-weak novelty.
 *   strafeMult  strafe speed ÷ forward (mecanum rollers < 1; omni/steered = 1; tank dead)
 *   speedMult   forward FREE speed ÷ ideal (roller slip + friction loss)
 *   accelMult   peak accel ÷ base (each drivetrain's traction limit μ·g ÷ the base)
 *   pushMult    EFFECTIVE shove mass in the Rapier solver (physicsEngine.ts) — real
 *               traction; mecanum/x-drive have little, so a tank shoves them around
 *   turnMult    max spin rate ÷ the geometric base (wheelSpeed/halfDiag). swerve > 1
 *               (vectored rotation = fastest turner); the rest = 1 (geometric)
 *   saturation  wheel budget: 'sum' |f|+|s|+|ω| · 'tank' |f|+|ω| · 'vec' hypot(f,s)+|ω|
 * Orders (all realistic): speed tank>swerve=mecanum≫xdrive (swerve's gear loss ≈ mecanum's
 * roller scrub → identical straight-line top speed; xdrive far back) · push
 * tank>swerve≫mecanum>xdrive · accel
 * tank>swerve>mecanum>xdrive · turn swerve>tank>mecanum>xdrive (swerve vectors for rotation).
 * Rebalanced 2026-07: tank the bulldozer, swerve the powerful/holonomic-but-wobbly all-rounder,
 * mecanum the light/PRECISE holonomic, xdrive a deliberately-weak novelty (worst by a margin). */
export const DRIVETRAIN_PRESETS = {
  /** FTC standard mecanum: the LIGHT, INSTANT, PRECISE holonomic pick — rollers change
   * direction with ZERO reorient lag (unlike swerve's pods), no wobble, and its low mass
   * FLOOR keeps it nimble. It's now the 2nd-fastest straight line (single-stage direct
   * drive, unlike swerve's gear-lossy modules), so it's "tank-lite + strafe": you give up
   * accel and pushing power vs tank in exchange for maneuverability. Costs: ~8% forward
   * loss (roller scrub), slower strafe, and modest pushing power (shoved by tank/swerve).
   * accelMult 1.12: close to swerve's EFFECTIVE accel (swerve's steady power draw eats ~10%
   * of its 1.32), so straight-line FEEL matches even though swerve keeps a slight burst edge
   * and more raw accel at equal weight — mecanum was feeling sluggish off the line at the old
   * 0.98. Even at the EXTREME min-weight, MAX-inertia, 500rpm corner, swerve (1.32 / floor
   * 21.5 → 25.5lb) still edges out the equivalent mecanum (1.12 / floor 18 → 22lb) by ~1.7% —
   * its higher accelMult just beats its heavier module floor. Swerve keeps the raw-accel edge. */
  mecanum: { strafeMult: 0.8, speedMult: 0.92, accelMult: 1.12, pushMult: 0.8, turnMult: 1.0, saturation: 'sum' },
  /** 45° omni X-drive: a deliberately-WEAK novelty with no honest competitive niche.
   * REALISTICALLY the worst by a wide margin: each omni sits at 45°, so a big chunk of
   * every wheel's speed is wasted off-axis (low top speed), the free-spinning side
   * rollers slip trivially (weakest traction → poor accel, shoved by everyone), and even
   * rotation scrubs. Fully symmetric (strafe = forward). A hard-mode/style pick only. */
  xdrive: { strafeMult: 1.0, speedMult: 0.74, accelMult: 0.58, pushMult: 0.35, turnMult: 0.9, saturation: 'sum' },
  /** traction wheels: no strafe, but a clear top-SPEED lead plus the best accel and
   * pushing power — the defensive anchor. speedMult 1.06: pushed above the ideal datum so
   * tank is decisively the fastest in a straight line (grippy wheels, least drivetrain loss). */
  tank: { strafeMult: 0, speedMult: 1.06, accelMult: 1.45, pushMult: 1.7, turnMult: 1.0, saturation: 'tank' },
  // (tank accelMult 1.45 × base 240 = 348 ≈ μ·g at μ 0.9 — the traction ceiling)
  /** steered traction modules: the HEAVY all-rounder — full-speed any direction +
   * strong push + good top speed, but its weight (mass FLOOR below) tanks its accel
   * and the pods must REORIENT on direction changes (MODULE_SLEW_RATE). Master of
   * none: tank out-accels + out-pushes it, mecanum out-accels + out-responds it. */
  // speedMult 0.92: MATCHED to mecanum — the module gearing (bevel + reductions) is lossy
  // but swerve rolls on GRIPPY traction wheels (vs mecanum's scrubbing rollers), and the two
  // losses cancel → identical straight-line top speed. accel stays traction-limited, push
  // unaffected. turnMult 1.15: it VECTORS all four wheels tangentially for rotation → the
  // fastest TURNER, its signature. Tradeoffs: WOBBLE (imprecise line), heavy mass, steering draw.
  // turnMult 1.18: kept above tank's raised speed so swerve stays the fastest turner.
  swerve: { strafeMult: 1.0, speedMult: 0.92, accelMult: 1.32, pushMult: 1.35, turnMult: 1.18, saturation: 'vec' },
  /** BUTTERFLY — traction wheels AND mecanum wheels on the same chassis, one set lifted
   * off the floor at a time (the driver drops the other mid-match). This entry is the
   * MECANUM-mode half so every generic `DRIVETRAIN_PRESETS[dt]` reader gets a sane
   * default; `BUTTERFLY_MODES` below holds both halves and `driveParams` picks. */
  butterfly: { strafeMult: 0.76, speedMult: 0.87, accelMult: 1.05, pushMult: 0.74, turnMult: 0.96, saturation: 'sum' },
} as const;

/**
 * LATERAL GRIP — how much of a TURN the wheels can carry the chassis' momentum through, as a
 * fraction of that drivetrain's own traction limit.
 *
 * Turning while moving needs a sideways force of m·v·ω to bend the velocity around with the
 * heading. Where the wheels can supply it the robot CARVES: the velocity follows the nose,
 * which is what a tank does, because treads grip sideways as hard as they grip forward. Where
 * they cannot, the chassis keeps going the way it was pointed and slides through the turn,
 * which is what mecanum rollers actually do.
 *
 * The sim had no term for this at all. Velocity is integrated in the WORLD frame and the
 * heading turned out from under it, so every drivetrain side-slipped through every turn and
 * the motor model then dragged the leftover lateral component away at its own accel. On tank
 * that reads as being shoved sideways mid-turn — "when I drive straight and turn with tank, I
 * feel like I get shifted slightly in a weird way ... tank does not slide much because of its
 * very grippy treads."
 *
 * A fraction of the drivetrain's traction ceiling (accelMult × BASE_DRIVE_ACCEL), because that
 * ceiling already IS μ·g for its wheels. So the carve is not free: past what the tyres can
 * supply — fast enough, turning hard enough — the robot slides anyway, and it slides sooner on
 * omnis than on treads.
 */
export const LATERAL_GRIP: Record<DrivetrainType, number> = {
  // TREADS ARE NOT THE SAME SIDEWAYS AS FORWARD — they are BETTER. Forward the wheels roll and
  // the limit is drive traction; sideways the whole tread has to scrub across the tile, which
  // is why a tank cannot strafe at all. So its lateral ceiling is well above its drive one.
  tank: 1.8,
  swerve: 0.9, // proper wheels, but four of them steering
  butterfly: 0.7, // dropped onto its traction wheels
  mecanum: 0.45, // 45-degree rollers — they carry some of it and slide the rest
  xdrive: 0.3, // omnis at 45 degrees, the least grip of the four
};

/**
 * BUTTERFLY DRIVE — the two halves.
 *
 * A real butterfly carries BOTH wheel sets plus the lift that swaps them, so it is never
 * quite either dedicated drivetrain:
 *  • it is ALWAYS hauling the set that is currently in the air (dead weight, and high in
 *    the chassis), which is why its mass FLOOR is the highest of any drivetrain, and
 *  • the deployed set rides on a LIFT LINKAGE rather than a hard-mounted axle, so some
 *    traction and shove is lost to compliance in that linkage.
 *
 * Both halves are therefore the dedicated drivetrain's multipliers times a small
 * EFFICIENCY TAX, weighted by how much each quantity actually suffers from a compliant
 * mount: push −7% (shove force loads the linkage worst), accel −6% (traction transfer
 * runs through it), speed −5% (mostly just gearing + a little scrub), turn −4% (least
 * affected — rotation is a light load). The result is a drivetrain that is never the
 * best at anything but is never far off either, which IS the archetype: you pay a few
 * percent everywhere and a weight penalty for the right to change your mind mid-match.
 */
export const BUTTERFLY_MODES = {
  /** mecanum set down: strafe + holonomic, mecanum's multipliers × the tax */
  mecanum: { strafeMult: 0.76, speedMult: 0.87, accelMult: 1.05, pushMult: 0.74, turnMult: 0.96, saturation: 'sum' },
  /** traction set down: no strafe, tank's push/accel/speed × the tax, tank's control model */
  tank: { strafeMult: 0, speedMult: 1.01, accelMult: 1.36, pushMult: 1.58, turnMult: 0.96, saturation: 'tank' },
} as const; // inertia at/above which the close floor vanishes

/** POWER DRAW: a running intake, plus the flywheel, pull current away from the
 * drive motors, so the robot gets slightly slower AND pushes weaker. Draw scales
 * drive speed/accel down by (1 − draw) and the Rapier shove mass by the same,
 * capped so it stays "slight". The flywheel has TWO terms (both × inertia):
 *  - HOLD: a small steady cost for keeping a spun-up wheel turning. Just being
 *    far from the goal barely matters — this is intentionally light.
 *  - SPIN-UP: the DOMINANT cost of ACCELERATING the wheel, i.e. actively driving
 *    AWAY from the goal so the required spin is climbing. Proportional to how
 *    fast the spin target is rising (per second) — a heavy (high-inertia) wheel
 *    is expensive to spin up, a light one is nearly free. Spinning DOWN (driving
 *    toward the goal) costs nothing. flywheelSpin is a 0..1 ramp with distance to
 *    the robot's own goal (FLY_SPIN_NEAR→FLY_SPIN_FAR); flywheelSpinRate is its
 *    positive rate of change (1/s), both set in updateRobotActions. */
export const POWER_DRAW_FLYWHEEL_HOLD = 0.04; // steady: inertia × spin (far & idle)
export const POWER_DRAW_FLYWHEEL_SPINUP = 0.45; // per 1/s of rising spin: inertia × rate
export const POWER_DRAW_INTAKE = 0.06; // intake motors running
/** SWERVE draws steady current just RUNNING — the four steering (pivot) motors
 * pull current to hold + correct pod angle even driving straight, on top of the 4
 * drive motors. So a swerve chassis is always a bit slower / weaker-shoving than an
 * equivalent mecanum. Applied whenever the drivetrain is swerve. */
export const POWER_DRAW_SWERVE = 0.1; // steady steering-motor current — kept modest; swerve's
// main weakness is now the mechanical efficiency loss baked into its speedMult, not amperage.
/** DRIVE current scales with RPM: a drivetrain geared for higher rpm pulls more current
 * from the pack to hold power at speed. Modeled only ABOVE the reference rpm (so the
 * 435-rpm base calibration is untouched), ramping to POWER_DRAW_DRIVE at the top rpm —
 * so high-rpm builds top out SUB-linearly and hit the draw cap sooner when also
 * shooting/intaking (voltage sag). Low-rpm builds draw nothing extra. */
export const POWER_DRAW_DRIVE = 0.05;
export const POWER_DRAW_DRIVE_TOP_RPM = 600;
export const POWER_DRAW_MAX = 0.2; // in of the radius, at the roller face only
/**
 * How briskly an artifact resting on a robot's TOP slides off it, per tick of contact.
 *
 * A robot's top is a lid over a mess of mechanism, not a shelf — an artifact that lands on one
 * works its way off rather than parking there for the rest of the match. Added as a velocity
 * each tick it is up there, outward from the robot's centre, so the direction is simply where
 * it landed and nothing is invented. Small: it should look like the artifact easing off a
 * moving roof, not being flicked.
 */
/**
 * CHASSIS SPRITE: square corners, thin outline.
 *
 * The corners were rounded by 1.6in, which is a sixth of a chassis and reads as a pebble
 * rather than as the welded box an FTC frame is — and the collision box has square corners,
 * so the drawing was disagreeing with the shape it stands for. The outline is thinner for the
 * same reason: it is drawn INSIDE the footprint (see `strokeInside`), so every bit of width
 * it takes is width taken off the robot's own body.
 */
export const CHASSIS_CORNER = 0; // in, corner radius of the drawn chassis
export const CHASSIS_OUTLINE = 0.5;
/** Intake presets model the REAL mechanism, not a touch-and-wait hitbox.
 * TOP LEVEL (feeds robotExtents → the Rapier robot-robot/wall collider, length
 * clamps, drawing):
 *   reach       forward extension of the box past the chassis front
 *   overhang    the compliant wheels may stick out past a narrower chassis
 *               (vector); without it the chassis ENCOMPASSES the intake so side
 *               intake is geometrically impossible
 *   min/maxLength  legal chassis length range · fireInterval  hopper→shooter cadence
 * mouth GEOMETRY (robot-local inches, front = +x):
 *   wedge       true = a FUNNEL front: two angled side slopes (from the front
 *               corners in to the throat) direct balls to the CENTER compliant
 *               wheels — NO flat front wall (sloped/triangle). false = a flat
 *               front, wheels span the whole mouth (vector).
 *   mouthHalf   half-width of the opening at the tip
 *   throatHalf  the funnel's THROAT half-width. It is NOT "the capture zone" any more —
 *               the fore-aft grab is `intakeNip` about `intakeAxleX`, shared by all three
 *               capture branches, and every LATERAL bound below is unchanged by that.
 *               throatHalf is now exactly four things: `atThroat`'s lateral bound, the
 *               `cornered` funnel's inner width, the `rammed`/`sideImpact` off-centre
 *               threshold, and the denominator of the capMin->capMax ramp.
 *   drawIn      suction speed (in/s) the running intake pulls a ball in the
 *               mouth toward the throat (0 = flat front, wheels grab in place)
 *   capMin/capMax  swallow interval as the capture point goes CENTER→EDGE
 *               (vector: compliant center fast, vectoring sides slow). On the half-tick
 *               grid — see the INTAKE_PRESETS header.
 *   clumpInterval  swallow cadence while 2+ balls sit at the mouth (WEDGE presets only;
 *               `interval` never reads it on a flat front)
 *   dual        capture TWO balls per cycle from a clump (triangle's 2 front slots)
 *
 * RESOLVED NIP, which is chassis-INDEPENDENT (both terms are per-preset constants):
 *   72mm roller (sloped, triangle)  back 1.517  front 1.800  ⇒ forward limit tip + 0.383
 *   48mm roller (vector)            back 1.157  front 1.346  ⇒ forward limit tip + 0.401
 * and the rest point the band must contain, `BALL_RADIUS − reach + intakeRollerDia/2` from
 * the axle:  sloped +0.917 · vector −0.055 · triangle −1.083. See INTAKE_TREAD_FRAC. */
/**
 * INTAKE ROLLER diameters, in mm to match how they are actually bought. The funnel presets
 * run a big 72mm compliant roller; the vector's wheel row is a smaller 48mm.
 *
 * The roller's FRONT FACE is the intake's reach — `footprintExtents` already puts the
 * collision front at `length/2 + reach` — so growing the diameter grows it BACKWARD into
 * the mouth and changes no physics at all. The wedges meet it at its axle, so the funnel
 * keeps a visible mouth in front of them.
 */
export const INTAKE_ROLLER_MM = { sloped: 72, vector: 48, triangle: 72 } as const; // in, each roller's width along the beam
/** roller diameter in inches for a spec */
export const intakeRollerDia = (spec: { intake: keyof typeof INTAKE_ROLLER_MM }): number =>
  INTAKE_ROLLER_MM[spec.intake] / 25.4;
/**
 * THE ROLLER AXLE in robot-frame x — ONE authority, read by the sim, the renderer and the
 * artifact solids.
 *
 * It was computed independently in three places (`drawRobot`'s `wedgeTip`/`axis`,
 * `artifactSolids`' `wedgeFront`) and the geometry the intake GRABS on is now derived from
 * it, so a fourth copy is how the drawn wheel and the capture zone drift apart. The `max(hl)`
 * mirrors `artifactSolids` — a roller bigger than twice the reach would otherwise put the
 * axle inside the chassis.
 */
export const intakeAxleX = (spec: { intake: keyof typeof INTAKE_PRESETS; length: number }): number => {
  const hl = spec.length / 2;
  return Math.max(hl, hl + INTAKE_PRESETS[spec.intake].reach - intakeRollerDia(spec) / 2);
}; // in/s
/**
 * GATE OPENER: a block on each end of the roller beam, filling out to the chassis edge.
 *
 * It is not decoration and it is not a new collider either — `footprintExtents` already
 * makes the whole front of the robot solid out to `width/2` and forward to `length/2 +
 * reach`, which is what lets an intake work the gate lever at all. The funnel presets'
 * roller only spans `mouthHalf`, so the drawing showed nothing out at the corners while the
 * collision box was solid there. This is the part that was missing from the picture, and
 * `npm test` asserts it lands exactly on the footprint corner rather than near it.
 */
/**
 * THE SWALLOW CADENCE IS 1-2 TICKS NOW, AND THE GRAB HAPPENS AT THE ROLLER NIP.
 *
 * The two halves of one change ("make the intaking speed extremely fast, but decrease the
 * effective intaking area"). The AREA is `intakeNip` about `intakeAxleX` — one fore-aft band
 * shared by all three capture branches, derived from the roller's own geometry — and the
 * SPEED is `capMin`/`capMax`/`clumpInterval` below, which are now measured in ticks rather
 * than in tenths of a second.
 *
 * ⚠️ EVERY INTERVAL SITS ON THE HALF-TICK GRID `(n − 0.5) / 60`, never on an exact multiple
 * of `SIM_DT`. The gate is `world.time − r.lastIntakeAt < interval` and `world.time` is
 * ACCUMULATED by `+= dt`, so an interval set exactly to `k * SIM_DT` is a float coin toss
 * that would resolve differently on either side of a rounding boundary. Free to avoid, and
 * invisible if you don't.
 *
 * ⚠️ `drawIn` HAD TO RISE WITH THEM, and this is the fact that makes the whole tuning work:
 * the wedge presets are TRAVEL-limited, not interval-limited. The measured back-to-back
 * swallow gap on sloped was 0.133 s against a `clumpInterval` of 0.04 — which is exactly why
 * the 2026-09-10 bisection found `clumpInterval` 0.04 -> 0.02 with `capMax` 0.09 -> 0.05
 * BYTE-IDENTICAL. Cutting the interval alone delivers nothing at all; what a queued artifact
 * pays is one ball diameter of travel to reach the seat. The ordering (vector < sloped <
 * triangle) and the ratios between them are preserved.
 */
export const INTAKE_PRESETS = {
  /** SLOPED: two side slopes funnel artifacts into the compliant wheels at the
   * throat — no flat front. maxLength = 18 − reach (the roller counts toward the
   * 18in cube). Fast + eats clumps. */
  sloped: {
    reach: 3, overhang: false, minLength: 13.5, maxLength: 15, minWidth: 14.5, fireInterval: 0.08, fireCap: 0,
    mouth: {
      wedge: true, mouthHalf: 7, throatHalf: 3, drawIn: 40,
      capMin: 0.00833, capMax: 0.05833, clumpInterval: 0.00833, dual: false,
    },
  },
  /** VECTOR WHEEL: flat front (no side slopes), the roller spans the whole mouth.
   * The mouth is exactly as WIDE AS THE CHASSIS (mouthHalf = width/2, applied per
   * robot in `intakeMouth` — the `8.5` below is only a fallback base), so there's
   * NO overhang: the wheel row matches the frame. CENTER intakes fast, the SIDES
   * slower (vectoring). Chassis 11.5..14.5in. */
  vector: {
    reach: 3.5, overhang: false, minLength: 11.5, maxLength: 14.5, minWidth: ROBOT_MIN_WIDTH, fireInterval: 0.1, fireCap: 0,
    mouth: {
      // flat plate spanning the chassis width; the mecanum wheels VECTOR a ball
      // laterally (drawIn) to the center compliant zone (throatHalf) before sucking
      // it in, so edge entries take longer — the vectoring time. `mouthHalf` here is
      // a fallback; the live value is the robot's half-width (see `intakeMouth`).
      //
      // THE SLOWEST OF THE THREE, and the only one that actually PAYS its centre->edge
      // ramp: 2 ticks at the centre against sloped's and triangle's 1, 8 ticks at the
      // edge, and NO clump bonus (`interval` takes `clumpInterval` only on a wedge, so
      // the field here is dead and is kept equal to `capMax` for consistency). A wedge's
      // funnel delivers everything to |y| ~ 0, so a wedge only ever pays `capMax` on a
      // `cornered` grab; `onRollerRow` is the one branch that grabs genuinely off-centre,
      // which is why the 4x spread is visible here and nowhere else.
      //
      // drawIn 21 -> 32 with the nip: vectoring an off-centre ball across a flat plate is
      // what this preset trades away, and the band it has to be vectored INTO is now
      // 2.5in deep rather than the whole 7in mouth.
      wedge: false, mouthHalf: 8.5, throatHalf: 3, drawIn: 32,
      capMin: 0.025, capMax: 0.125, clumpInterval: 0.125, dual: false,
    },
  },
  /** TRIANGLE: named for the triangular ball storage (2 near the mouth, 1 deep).
   * Sloped-style funnel slopes + longest reach; devours a clump TWO at a time.
   * Transfer is the SAME as the others EXCEPT a max-rate CAP (`fireCap`): it can't
   * fire faster than that, but when conditions are already slower than the cap
   * (flywheel recovery on far shots) it fires at the same rate as everyone else. */
  triangle: {
    reach: 5, overhang: false, minLength: 11, maxLength: 13, minWidth: 15.5, fireInterval: 0.08, fireCap: 0.095,
    mouth: {
      // strongest INTAKE of the three (its identity — devours clumps): a hard
      // suction (drawIn) snaps balls to the throat and it swallows quickest. The
      // tradeoff is TRANSFER (fireCap), not the grab — those stay untouched.
      //
      // Same 1-tick centre as sloped, but a shallower edge penalty (3 ticks against 4)
      // and `dual` still takes TWO per cycle from a clump: 120 artifacts/s off a pile
      // against sloped's 60. It fills a 3-slot hopper in two ticks and still shoots
      // slowest — `fireInterval`/`fireCap` below are the SHOOTER and are untouched by
      // the intake work; they share no state with `lastIntakeAt`.
      //
      // "Make triangle intake transfer slightly faster." The CAP was not what was slow:
      // measured, the gap between shots was 0.133s against a cap of 0.12, so the cap
      // never bound at all and lowering it alone changed nothing (7.50/s either way).
      // What binds is `fireInterval` plus the flywheel recovery, so that is what moved:
      // 0.10 -> 0.09, with the cap eased to 0.105 so it still sits just under the
      // result and remains the thing that stops this preset being the fastest shooter.
      // It is still the only preset with a cap, and still slower than sloped's 0.08 —
      // the triangle grabs best and shoots slowest, by a little less than before.
      wedge: true, mouthHalf: 7, throatHalf: 3.5, drawIn: 70,
      capMin: 0.00833, capMax: 0.04167, clumpInterval: 0.00833, dual: true,
    },
  },
} as const;

/** the intake mouth geometry as it applies to a SPECIFIC robot. The VECTOR wheel
 * row spans the FULL chassis width (mouthHalf = width/2 — the intake is exactly as
 * wide as the robot, no overhang); sloped/triangle keep their fixed funnel mouth.
 * Every site that reads the mouth width per-robot (capture, ball collision, both
 * renderers) goes through here so the width rule lives in ONE place. */
export interface IntakeMouth {
  wedge: boolean;
  mouthHalf: number;
  throatHalf: number;
  drawIn: number;
  capMin: number;
  capMax: number;
  clumpInterval: number;
  dual: boolean;
}
export function intakeMouth(spec: { intake: keyof typeof INTAKE_PRESETS; width: number }): IntakeMouth {
  const m = INTAKE_PRESETS[spec.intake].mouth;
  return spec.intake === 'vector' ? { ...m, mouthHalf: spec.width / 2 } : m;
} // in/s

export const HOPPER_CAPACITY = 3; // in/s
/**
 * FTC25 CONTROLS — team 2627's outtake power presets (`TeleOP25`: `outtakePrePower` starts at
 * 1.0, and the operator's d-pad picks 0.9 / 0.8 / 1.0 / 0.4), as fractions of
 * `LAUNCH_MAX_SPEED`. Their LENGTH is the number of presets, and their values are the DEFAULT
 * table: the player edits their own (`GameSettings.ftc25Powers`), and what a robot actually
 * launches at is the table it spawned with (`AssistConfig.manualShot`), indexed by
 * `RobotCommand.shotPower` — index 0 the preset it powers up on.
 *
 * ⚠️ 0.4 × 320 = 128 in/s is BELOW the slowest shot that can reach the goal opening from
 * anywhere (~144 in/s point-blank, `solveShot`): under this field's geometry a preset under ~45 %
 * always falls short. That is the honest answer for a DECODE goal, not a bug in the preset.
 */
export const FTC25_SHOT_POWERS: readonly number[] = [1.0, 0.9, 0.8, 0.4];
/** the lowest a preset may be set to (`GameSettings.ftc25Powers`, `coerceAssists`): a launcher
 *  that barely turns over is not a setting anyone means */
export const FTC25_MIN_POWER = 0.05;
/** how many of the player's OWN custom start positions per category (close/far) */
export const MAX_SAVED_STARTS = 2;

/**
 * The same cap for a SUPPORTER — one of the membership's convenience perks.
 *
 * Two rules follow from this being a PAID tier, and both matter more than the
 * number itself:
 *
 *  1. SANITIZE against this, never against the free cap. `coerceSettings` slices
 *     the saved list on every load, and slicing to 2 would silently DESTROY a
 *     supporter's poses on any load where the entitlement had not resolved yet,
 *     and again the moment a membership lapsed. Data loss is not an acceptable
 *     way to say "your subscription ended", so the PERSISTED ceiling is always
 *     the high one and only the Save button respects the entitlement.
 *  2. It is deliberately NOT enforced server-side. Hand-editing localStorage to
 *     get six slots is possible and fine: this is a convenience that cannot
 *     affect how a robot drives or scores (product rule, and the terms say so),
 *     and there is nothing here worth defending with a round-trip.
 */
export const MAX_SAVED_STARTS_SUPPORTER = 6;

/** G304 "touching the GOAL or FIELD perimeter" slack (inches): a start pose
 * whose footprint is within this of the goal face or a wall counts as touching.
 * Also the snap distance the drag editor uses to pull a robot onto a surface. */
export const START_TOUCH_TOL = 1.25;

// -------------------------------------------------------- robot presets ----
/** how many of the player's OWN robots / autos they can keep in their library */
export const MAX_SAVED_ROBOTS = 3;

// ------------------------------------------------------------------ sim ----
// 60 Hz fixed timestep. Lower than 120 so weaker browsers can sustain it (in
// lockstep multiplayer everyone is coupled to the slowest peer) and so the
// 8-tick INPUT_DELAY buffer covers ~133 ms of latency. step() is dt-parameterized
// (physics scales with dt), so this stays deterministic across peers.
export const SIM_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5; // rad/s

// ------------------------------------------------------------ rendering ----
export const COLORS = {
  /** letterbox around the field — tracks `--ds-bg` in shell.css, per THEME (scripts/smoke.ts
   * asserts the pair, so a retune of one without the other fails `npm test`).
   * The field mat NEVER themes: the board reads as a physical object sitting on
   * the floor, and its outline keeps it separated even when the floor goes dark
   * (`backdropDark` #20262c vs `mat` #23262b is only 1.03:1 on fill alone). */
  backdrop: '#f9faf7',
  backdropDark: '#20262c',
  mat: '#23262b',
  tile: '#2c3038',
  wall: '#4b5563',
  red: '#ef4444',
  redDim: 'rgba(239,68,68,0.10)',
  blue: '#3b82f6',
  blueDim: 'rgba(59,130,246,0.10)',
  /**
   * THE ALLIANCE HUES AS 12-PX TYPE — the driver-name labels `renderer.ts` floats over
   * every remote robot, and nothing else.
   *
   * A separate pair because `red`/`blue` do not clear AA as TEXT on the field: measured
   * against the lightest ground a label ever crosses (`tile`, #2c3038) they are 3.52:1 and
   * 3.60:1, i.e. fine as the fat shapes they were drawn for and under the 4.5:1 floor for a
   * name somebody has to read mid-match. The tints are 4.78:1 and 5.20:1 there, 5.49:1 and
   * 5.97:1 on the mat, and 6.23:1 and 6.78:1 against the label's own dark stroke — which is
   * the other pair that matters, since the stroke is what carries the glyphs onto the LIGHT
   * backdrop (9.34:1 there) and onto whatever a 3D scene puts behind them.
   *
   * Category 3 in CLAUDE.md's theming note: their ground is the CANVAS, and the field is
   * hardcoded dark, so they never theme. `scripts/contrast.mjs` asserts every number above.
   */
  redLabel: '#f87171',
  blueLabel: '#60a5fa',
  white: '#e5e7eb',
  purple: '#a855f7',
  green: '#22c55e',
  launchTint: 'rgba(229,231,235,0.05)',
} as const;

/**
 * Supporter cosmetic: the robot's CHASSIS FILL.
 *
 * Scoped to the fill on purpose. A robot's alliance is carried by its NAME LABEL,
 * sign placard and heading chevron (the red/blue outline was removed 2026-09-21 —
 * see `ROBOT_TRIM` in `render/drawRobot.ts`), never by the fill, which was always
 * one flat `#1f242c`. Recolouring only the fill therefore cannot make
 * a red robot read as blue, which is the one thing a cosmetic must never do in a
 * game where you identify targets at a glance.
 *
 * An ALLOWLIST rather than a free hex picker, for three reasons that all matter
 * more than the extra choice would:
 *  - sanitizing a free colour string means parsing untrusted CSS on the wire;
 *  - every entry is chosen dark enough to keep the alliance outline readable
 *    against it, and distinct from the mat (#23262b) and tile (#2c3038) so a
 *    robot never camouflages into the field;
 *  - nobody can pick the artifact green/purple and fake a scoring element.
 *
 * The KEY is what goes over the wire and into replays, never the hex — so these
 * values can be retuned later without invalidating a single saved robot.
 */
/*
 * MOVED to `src/cosmetics.ts` on 2026-09-20 (the registry grew accents, decals and plates, and
 * the palette went vivid — see that file's header for the halo that keeps the outline readable).
 * Re-exported here so every existing importer keeps its name. The seven old dark keys
 * (slate/plum/moss/rust/navy/cocoa) are gone; a saved robot carrying one reads as `default`.
 */
export { CHASSIS_COLORS, CHASSIS_COLOR_KEYS, chassisFill, type ChassisColor } from './cosmetics'; // in outward from the wall
