import type { Artifact, Alliance, RobotCommand, RobotState, Vec2, World } from '../types';
import * as C from '../config';
import { inRect } from './field';
import type { Rect } from './field';
import {
  closestPointOnRobot,
  driveIntent,
  robotCorners,
  robotExtents,
  robotIntersectsRect,
  robotPointVelocity,
} from './physics';
import { hyp, rot } from '../math';

/**
 * THE SHARED SECTION 11 TESTS — the CONTROL count behind over-control (`controlledArtifacts`) and
 * the PINNING test (`isPinning`). BIOBUZZ's penalty engine (`src/games/biobuzz/penalties.ts`)
 * calls both; Chain Reaction models only its contact rules and calls neither. Pure and
 * deterministic, and every per-element clock lives in `world.penalties` as plain JSON.
 *
 * DECODE's own engine (`updatePenalties`: G402, G408, G417/G418 at the gate, G422, G424–G427)
 * lived here and was removed with DECODE on 2026-10-12. Both tests used to default their FIELD
 * to DECODE's (the loading-zone carve-out, a 3-slot hopper, the 2.5 in artifact, the goal wedges
 * and classifier channels as pin solids); BIOBUZZ always passed its own, so the geometry is a
 * required argument now and nothing here knows any one field.
 */

/**
 * A ROBOT IS "IN" A ZONE IF ANY PART OF IT IS — ONE PREDICATE, EVERY ZONE RULE.
 *
 * Every DECODE zone is defined in Section 9 and the glossary as an "infinitely tall volume"
 * (GATE 2.75x10, SECRET TUNNEL 46.5x6.125, LOADING 23x23, BASE 18x18), and the rules that use
 * them all ask whether a ROBOT "is in" one. So the test is plain OVERLAP between that volume's
 * footprint and the robot's TOP-DOWN SILHOUETTE — the collision OBB, intake reach included,
 * since an overhang is as much inside an infinitely tall volume as a wheel is.
 *
 * It was a corner/center containment test, which is not the same thing and is strictly weaker:
 * a robot whose BODY covers part of a zone while its four corners straddle it and its center
 * sits outside was not in the zone. That is not exotic — it is a BASE ZONE corner poking into
 * the middle of a robot's edge, or a robot lying across the tunnel strip, which is narrower
 * (6.125in) than any legal robot. G424 already used the SAT test for exactly this reason; the
 * other three rules read the same word in the same manual and now answer it the same way.
 *
 * Don't confuse this with BASE PARKING SCORING, which is deliberately NOT this test: a ROBOT
 * "returned to BASE" is defined by SUPPORT ("must only be supported ... by the TILE in the
 * BASE ZONE"), so that one counts wheel ground-contact points and belongs in scoring.ts.
 * G427 protects the ZONE, the BASE award measures what the TILE holds up; the manual draws
 * that line itself, and so do we.
 */
function robotInZone(r: RobotState, rect: Rect): boolean {
  return robotIntersectsRect(r, rect);
}

/**
 * HOW MANY ARTIFACTS THIS ROBOT IS CONTROLLING.
 *
 * DECODE DEFINES EXACTLY ONE TERM HERE, and it is CONTROL. This function used to be written
 * against two others — an FRC-style POSSESSION ("as the ROBOT moves or changes ORIENTATION,
 * the object remains in approximately the same position relative to the ROBOT") and a TRAPPING
 * ("preventing the movement of a SCORING ELEMENT against a FIELD element") — and NEITHER IS IN
 * THIS MANUAL. There is no POSSESSION entry and no TRAPPING entry in the DECODE glossary; the
 * word TRAPPING does not appear in Section 11 at all, and the only PIN/PINNING definition is
 * about opponent ROBOTS. The quoted TRAPPING was DECODE's PIN/PINNING with "opponent ROBOT"
 * swapped for "SCORING ELEMENT". Two invented tests carried most of the weight of the rule.
 *
 * The real definition, verbatim (Section 16, V2):
 *
 *   "an action by a ROBOT in which the SCORING ELEMENT is fully supported by or stuck in, on,
 *    or under the ROBOT or it intentionally pushes a SCORING ELEMENT to a desired location or
 *    in a preferred direction (i.e., herding). CONTROL requires contact with a ROBOT, either
 *    directly or transitively through other SCORING ELEMENTS. Typically, CONTROL requires one
 *    of the following to be true:
 *      A. The SCORING ELEMENT is fully supported by the ROBOT
 *      B. The ROBOT is moving the SCORING ELEMENT in a preferred direction with a flat or
 *         concave face of the ROBOT"
 *
 * So there are exactly two ways to control an artifact, and this function is the two of them:
 *
 *   A. FULLY SUPPORTED — the hopper. `r.hopper.length`, added at the bottom.
 *   B. HERDING — "intentionally pushes ... to a desired location or in a preferred direction",
 *      which decomposes into four things the code can actually ask:
 *        · CONTACT with the footprint (the definition says so outright), directly or
 *          TRANSITIVELY through other artifacts;
 *        · a FLAT OR CONCAVE FACE — `contactFace` returns null off a convex CORNER, which is
 *          the one piece of geometry clause B names and the engine had never modelled;
 *        · IN A PREFERRED DIRECTION — the robot's own rigid-body velocity AT the contact point
 *          must carry it INTO the artifact along that face's outward normal. A direction, not
 *          a speed: the previous test was the artifact's ABSOLUTE speed, which says nothing
 *          about who is moving it or where;
 *        · INTENTIONALLY — sustained past POSSESSION_CONFIRM while the artifact keeps its
 *          station on the chassis. The manual gives no numeric test for intent, so this is the
 *          sim's proxy for a referee's eye, and it is the whole of the BULLDOZING and
 *          DEFLECTING carve-outs: something you clip in passing never lasts, and something
 *          that bounces off leaves at once.
 *
 * ...AND "TO A DESIRED LOCATION" IS WHY CONTROL LATCHES.
 *
 * Once herding has been established the artifact stays controlled while contact and station
 * hold, whether or not the robot is still pushing — because having pushed it somewhere and
 * held it there is the first half of that phrase. This is what replaced the invented TRAPPING
 * branch, and it lands in the same place from the real definition: a robot that drove a pile
 * into the perimeter and sits on it is controlling the pile. Measured before this change, that
 * robot paid four MINORs once and then held the pile for the rest of the match for free.
 *
 * It also removes the two ABSOLUTE-SPEED gates that stood in front of the whole rule. There is
 * no speed floor anywhere in the definition, and the floors were exploitable in both
 * directions: a hoard crept below POSSESSION_MOVE_SPEED was invisible (measured: a six-artifact
 * pile walked for twelve seconds, zero fouls), and a jammed pile read as uncontrolled precisely
 * because it could not move. A robot that never pushed anything never latches, so the case that
 * these gates were reached for — "I'm getting spammed with over-possession continuing penalties
 * just by standing still" — is answered by intent rather than by a velocity threshold.
 */

/**
 * HOW HARD THE ROBOT IS PUSHING this artifact, in in/s along the outward contact direction —
 * or NULL if the artifact is not on a face the rule allows you to herd with.
 *
 * This is CONTROL clause B in one number: "The ROBOT is moving the SCORING ELEMENT in a
 * preferred direction with a FLAT OR CONCAVE FACE of the ROBOT."
 *   · the FACE half is the null: a corner is neither flat nor concave, and a ball met by a
 *     vertex squirts off it rather than being taken anywhere, which is why the rule names the
 *     geometry at all;
 *   · the PREFERRED DIRECTION half is the sign: the robot's own rigid-body velocity at the
 *     contact, projected onto the direction it would drive the artifact.
 */
function contactPush(
  r: RobotState,
  b: Artifact,
  cp: Vec2,
  loc: Vec2,
): { speed: number; dirX: number; dirY: number } | null {
  const e = robotExtents(r);
  // how far the artifact's centre lies BEYOND each face plane; the nearest feature is a convex
  // CORNER precisely when it is beyond both at once, which is the whole of the clause-B test
  const ox = loc.x > e.front ? loc.x - e.front : loc.x < -e.rear ? loc.x + e.rear : 0;
  const oy = loc.y > e.half ? loc.y - e.half : loc.y < -e.half ? loc.y + e.half : 0;
  if (ox !== 0 && oy !== 0) return null; // a convex CORNER — neither flat nor concave
  /**
   * The outward direction is taken from the CONTACT, not by snapping to a face: for an artifact
   * resting on a face it IS that face's normal, and it has no degenerate case. Snapping was
   * tried and is subtly broken — an artifact equidistant from the front face and a flank (which
   * a square-ish chassis makes an ordinary position, not a corner case) picks its face on a
   * 1e-11 rounding, and picking the flank means a robot driving dead ahead reads as pushing
   * NOTHING. Measured, that silently zeroed the whole rule for a centred artifact.
   */
  let dx = b.pos.x - cp.x;
  let dy = b.pos.y - cp.y;
  let m = hyp(dx, dy);
  if (m < 1e-6) {
    // centre INSIDE the footprint (a deep overlap): the way the chassis would shove it out
    dx = b.pos.x - r.pos.x;
    dy = b.pos.y - r.pos.y;
    m = hyp(dx, dy);
  }
  if (m < 1e-6) return null;
  /**
   * "MOVING the SCORING ELEMENT" is the magnitude; "in a PREFERRED DIRECTION" is the sign, and
   * the sign is only ever used to rule out the robot pulling AWAY. Projecting onto the outward
   * normal and using THAT as the magnitude is too strong: a robot spinning a corralled pile has
   * a purely TANGENTIAL point velocity, so its outward component is zero and a pile swung round
   * on the spot read as uncontrolled — which is the opposite of what anyone watching would say.
   *
   * Relaxing the magnitude costs nothing, because what stops a DRIVE-PAST from counting is not
   * the sign but the STATION test above: an artifact the robot slides past sweeps the length of
   * the chassis and re-anchors in a few hundredths of a second, where one carried round by a
   * spin holds a constant `loc` (the anchor is in the ROBOT frame, so rigid rotation does not
   * move it). Direction still rules out reversing off an artifact, and the tolerance is there
   * so a tangential contact cannot be tipped negative by rounding.
   */
  const pv = robotPointVelocity(r, cp);
  if ((pv.x * dx + pv.y * dy) / m < -C.POSSESSION_PUSH_MIN) return null; // backing away, not herding
  const speed = hyp(pv.x, pv.y);
  if (speed < C.POSSESSION_PUSH_MIN) return null;
  // ...and WHICH WAY it is being taken: the contact point's own direction of travel. Not the
  // outward normal — under a SPIN the point velocity is purely tangential and the normal
  // component is zero, so a corralled pile swung round would read as going nowhere.
  return { speed, dirX: pv.x / speed, dirY: pv.y / speed };
}

/**
 * The two things the CONTROL test needs that are NOT the same in every game.
 *
 * Everything else in `controlledArtifacts` is already game-neutral and stays that way: the
 * flat-or-concave face is `robotExtents`, which resolves whatever intake and mount THIS robot
 * has, and the station/carry tests are about the artifact's motion. These two are not.
 */
export interface ControlGeometry {
  /**
   * The zone carve-out C is scoped to — the manual's "attempting to acquire a SCORING ELEMENT
   * FROM THE LOADING ZONE". Every game has a restock corner and no two put it in the same
   * place; read against DECODE's, a BIOBUZZ robot collecting its own NECTAR is billed for
   * herding and a robot in DECODE's corner is excused for nothing.
   */
  carveOut(a: Alliance): Rect | null;
  /**
   * How many elements this robot's hopper holds.
   *
   * It is the ceiling on the intake-MOUTH carve-out — an artifact on its way into a slot is
   * already charged against the limit by the slot waiting for it, so a robot with no room is
   * acquiring nothing and gets no exemption. Read against DECODE's 3, a BIOBUZZ robot carrying
   * its legal 4 reads as full and loses the carve-out entirely.
   */
  hopperCap(r: RobotState): number;
  /**
   * The artifact radius to assume for an artifact that does not carry its own (`Artifact.r`).
   * It sets how close counts as TOUCHING and how far the transitive chain reaches, so
   * DECODE's 2.5 in applied to a 2.8 in BIOBUZZ POLLEN makes both too generous by more than
   * an inch — the chain by twice that.
   */
  radius: number;
  /**
   * WHICH ARTIFACTS ARE LOOSE ON THE FLOOR, i.e. the set this rule is allowed to count at all.
   *
   * Default `b.state.kind === 'ground'`, which is what this function has always used and is
   * exactly right for a PLANAR solve: DECODE and Chain Reaction tag an artifact `ground` from
   * the moment it lands until something takes it, so the tag and the fact agree.
   *
   * ⚠️ They stop agreeing under a 3D solve. A ball being PLOWED skips — it leaves the tiles by
   * a fraction of an inch between strikes — and a tagger that asks "is it off the floor or
   * moving vertically?" calls that `flight`. Measured on BIOBUZZ 3D, 14.3% of the ticks a
   * chassis was in contact with an element it was pushing, that element was tagged `flight`,
   * so the rule could neither count it nor keep a clock on it. A game whose tag flickers
   * supplies its own answer here; the ones whose tag does not, say nothing and are unchanged.
   */
  loose(b: Artifact): boolean;
}

export function controlledArtifacts(
  world: World,
  r: RobotState,
  dt: number,
  intaking: boolean,
  geom: ControlGeometry,
): number {
  const pen = world.penalties;
  const home = geom.carveOut(r.alliance);
  const R0 = geom.radius;
  /**
   * This artifact's own radius. TOUCHING the footprint is one of these plus the margin, and
   * the transitive chain is TWO of them — which is why both tests read it per artifact rather
   * than off a pair of constants: a game with two element sizes (BIOBUZZ's 2.8 in POLLEN and
   * 3.6 in NECTAR) has no single right answer to either. DECODE sets no `Artifact.r`, so both
   * collapse to exactly the constants they replace.
   */
  const rad = (b: Artifact): number => b.r ?? R0;
  const isLoose = geom.loose;
  const loose = world.balls.filter(isLoose);

  const held = new Set<number>();
  /**
   * Artifacts the robot is PHYSICALLY TOUCHING this tick, established hold or not.
   *
   * This is what the transitive chain is allowed to start from. See the chain below: an
   * EXCUSED artifact may conduct, but only one the robot is actually against — otherwise an
   * exemption, whose whole job is to REMOVE liability, silently hands the chain a seed and
   * adds REACH instead.
   */
  const touching = new Set<number>();
  for (const b of loose) {
    const key = `${r.id}:${b.id}`;
    const cp = closestPointOnRobot(r, b.pos);
    // `rad(b)` rather than the flat `reach`, so a game with two element SIZES measures each
    // one against its own skin. DECODE sets no `Artifact.r`, so this IS `reach` there.
    if (hyp(b.pos.x - cp.x, b.pos.y - cp.y) > rad(b) + C.POSSESSION_CONTROL_MARGIN) {
      /**
       * Not touching THIS TICK: the clock drains, and a long enough gap forgets the station.
       *
       * An ESTABLISHED hold still counts while it drains, though, and that is not a fudge — it
       * is the difference between the rule working in open space and not. Artifacts do not ride
       * a bumper here, they bounce off it and are re-struck, so a herded pile is in contact
       * only intermittently. Counting an artifact solely on the ticks it happens to be touching
       * meant a robot pushing a six-clump across the floor controlled exactly THREE (its hopper)
       * for 97% of ticks the moment the driver so much as steered — measured — and the rule
       * simply never fired. Reported as "when I just push a clump in open space it doesn't
       * give me [the penalty]".
       *
       * The drain is what bounds it: at POSSESSION_LEAK an artifact stops counting a couple of
       * confirm-windows after the robot really has left it, and one that was never established
       * has nothing to drain.
       */
      const prev = pen.ballHold[key];
      if (prev !== undefined) {
        const t = prev - dt * C.POSSESSION_LEAK;
        if (t <= 0) {
          delete pen.ballHold[key];
          delete pen.ballAnchor[key];
        } else {
          pen.ballHold[key] = t;
          if (t >= C.POSSESSION_CONFIRM) held.add(b.id);
        }
      }
      continue;
    }
    touching.add(b.id);
    const loc = rot({ x: b.pos.x - r.pos.x, y: b.pos.y - r.pos.y }, -r.heading);
    const anchor = pen.ballAnchor[key];
    const carried = (pen.ballCarry ??= {});
    const stationed =
      anchor !== undefined && hyp(loc.x - anchor.x, loc.y - anchor.y) <= C.POSSESSION_DRIFT;
    if (!stationed) {
      /**
       * First contact, or it has slid to a NEW station on the chassis — re-anchor there rather
       * than crediting travel across the robot as if it had stayed put. `loc` is in the ROBOT
       * frame, so turning with an artifact held in front of you does not move it: only an
       * artifact actually slipping relative to the chassis re-anchors.
       *
       * A re-anchor RESTARTS the clock but does NOT break an ESTABLISHED hold, because the two
       * are different questions: the clock is how control is ACQUIRED, and contact is how it is
       * KEPT. An artifact still touching the robot has not got away from it. Resetting an
       * established hold here silently unmade the rule in the one place it bites hardest — a
       * pile driven into the perimeter COMPRESSES as it jams, every artifact re-anchors on the
       * same tick, and a stalled robot has no push left to rebuild the clock with. Measured,
       * shoving a six-clump onto a wall and leaning on it drew nothing at all.
       */
      pen.ballAnchor[key] = { x: loc.x, y: loc.y };
      const was = pen.ballHold[key] ?? 0;
      const latched = was >= C.POSSESSION_CONFIRM;
      pen.ballHold[key] = latched ? was : 0;
      // the WORLD origin travels with the hold, not with the station: a latched artifact
      // shuffling along the bumper has not been re-found, and re-zeroing how far it has come
      // every time it slips would mean a pile that rattles can never be shown to have moved.
      if (latched) held.add(b.id);
      continue;
    }
    /**
     * CLAUSE B, as the clause actually reads: a FLAT OR CONCAVE FACE, and the ROBOT moving the
     * artifact IN A PREFERRED DIRECTION. `robotPointVelocity` carries the ω×r term, so a robot
     * turning a corralled pile is moving it just as surely as one driving into it — which is
     * how "changes ORIENTATION" survives the loss of the FRC definition it used to come from.
     */
    /**
     * ...and clause B's verb is MOVING: the robot has to be driving into it (`push`), on a face
     * rather than a corner (`push !== null`), AND THE ARTIFACT HAS TO ACTUALLY BE GOING
     * SOMEWHERE. Pressing on something that cannot move is contact, not herding — G408's own
     * "bulldozing ... while in the path of the ROBOT moving about the FIELD".
     *
     * This gates ACQUIRING only. The latch below carries an established hold straight through a
     * jam, so a pile you DROVE into the wall keeps counting while one that was already there
     * never starts. That split is the whole of the leniency: running into things is free,
     * taking them somewhere is not.
     */
    const push = contactPush(r, b, cp, loc);
    let carry = carried[key] ?? 0;
    // how far the artifact ACTUALLY WENT this tick in the direction the robot is taking it,
    // projected so that squirting SIDEWAYS out of a squeeze earns nothing: a row pinned on the
    // perimeter is moving quickly and travelling nowhere.
    const along = push ? b.vel.x * push.dirX + b.vel.y * push.dirY : 0;
    if (along > 0) carry += along * dt;
    carried[key] = carry;
    let t = pen.ballHold[key] ?? 0;
    /**
     * ...AND AN ARRIVAL IS NOT A JOURNEY. The hold ADVANCES while the artifact is still being
     * taken somewhere, and DRAINS while it is merely being leaned on — even in full contact.
     *
     * Without that drain, control latched on the way in and never let go: shoving two artifacts
     * against a wall billed once for the push (fair, you did herd them there) and then again
     * every POSSESSION_REBILL_S for as long as you stayed, while nothing moved at all. Reported
     * as "I still get penalties when I'm pushing forward against two balls against the wall...
     * it counts as me moving them even tho its basically staying in place."
     */
    /**
     * ...AND THE ROBOT HAS TO HAVE BEEN BULLDOZING WHEN THEY WENT (`POSSESSION_HERD_SPEED`).
     *
     * The distance test says the artifacts travelled; this says the robot was pushing hard
     * enough for that to be herding rather than working through a pile. Both are required, so
     * this only ever makes the rule kinder. Without it there was no gradient at all: every
     * throttle from a feather touch to a full ram drew the same 6 MINORs and the same card.
     */
    const herding = !!push && push.speed >= C.POSSESSION_HERD_SPEED;
    if (herding && carry >= C.POSSESSION_CARRY_DIST && along > C.POSSESSION_MOVE_MIN) t += dt;
    else if (!herding || along <= C.POSSESSION_MOVE_MIN) t = Math.max(0, t - dt * C.POSSESSION_LEAK);
    pen.ballHold[key] = t;
    // ...and once it is established it LATCHES: "pushes a SCORING ELEMENT TO A DESIRED
    // LOCATION" does not stop being true when the robot stops shoving.
    if (t >= C.POSSESSION_CONFIRM) held.add(b.id);
  }

  /**
   * ...AND AN ARTIFACT ON ITS WAY INTO A SLOT IS NOT A FOURTH ARTIFACT.
   *
   * POSSESSION_LIMIT and HOPPER_CAPACITY are the same three, so an artifact being drawn in is
   * already charged against the limit by the slot waiting for it — counting it in the mouth as
   * well charges that slot twice. It is capped at the room actually LEFT, nearest the mouth
   * first. A FULL robot is acquiring nothing, so it gets none of it and ploughs exactly as hard
   * with the intake running as without — the case that made this worth capping rather than
   * deleting.
   *
   * NOTE this is NOT G408's carve-out C, which is narrower ("inadvertent contact with a SCORING
   * ELEMENT while attempting to acquire a SCORING ELEMENT FROM THE LOADING ZONE" — that one is
   * `inHome` below). This is the sim's own, and it exists because the sim's intake is a
   * multi-tick animation where a real one is instantaneous: an artifact the rollers already own
   * would otherwise be billed for the fraction of a second it spends visibly outside the frame.
   */
  const excused = new Set<number>();
  /**
   * Of the excused, the ones that may still CARRY the chain.
   *
   * The two carve-outs below do not mean the same thing, and treating them alike is what let a
   * PARKED robot be charged for a pile it was merely standing next to. The MOUTH exemption says
   * “the rollers already own this one”, so the pile pressed against the robot THROUGH it is
   * still the robot’s doing and must keep counting. The LOADING-ZONE carve-out says the
   * opposite: “you are allowed to be among these” — letting it conduct re-imposes exactly the
   * liability the carve-out exists to remove, one artifact further along.
   */
  const conducts = new Set<number>();
  /**
   * ...AND IT COVERS WHAT THE ROLLERS ARE ACTUALLY TAKING, WHICH IS ONE ARTIFACT (two for a
   * triangle's twin slots) — NOT the whole hopper.
   *
   * Bounding it by hopper ROOM alone is what made this rule unreachable for anyone playing with
   * the assists on, which is the default. `autoFire` keeps all three slots empty, `autoIntake`
   * keeps `intaking` true, so THREE artifacts were excused on every tick forever. Measured on a
   * six-clump herded in open space with the player's own defaults: the robot was in contact with
   * SIX artifacts the whole way, three were excused every tick, the count never passed the limit
   * and the foul never came — 0 MINORs, against 9 for the same push with auto-intake off.
   *
   * The exemption exists because the sim's intake is a multi-tick animation where a real one is
   * instantaneous, so it should cover the artifact the rollers own RIGHT NOW and nothing else.
   * An intake takes one per cycle; excusing a hopper's worth at once modelled nothing.
   */
  const perCycle = C.INTAKE_PRESETS[r.spec.intake].mouth.dual ? 2 : 1;
  const cap = geom.hopperCap(r);
  let room = Math.min(perCycle, Math.max(0, cap - r.hopper.length));
  if (room > 0 && intaking) {
    const mouth = [...held]
      .map((id) => {
        const b = loose.find((x) => x.id === id)!;
        const loc = rot({ x: b.pos.x - r.pos.x, y: b.pos.y - r.pos.y }, -r.heading);
        return { id, ahead: loc.x, hold: pen.ballHold[`${r.id}:${b.id}`] ?? 0 };
      })
      /**
       * ...AND ONLY FOR AS LONG AS ACQUIRING TAKES.
       *
       * Hopper room alone is not enough, and this is exactly how it fails: a driver who keeps
       * shooting keeps three slots open, so three artifacts are excused permanently, and
       * herding up to six of them in a straight line with the intake held costs nothing.
       * Reported as "I am able to completely avoid penalties in some cases where I'm simply
       * herding going straight."
       *
       * An intake takes what is in its mouth in well under a second. Past that window an
       * artifact has had every chance to be taken, so whatever is happening to it, it is not
       * being acquired — it is being pushed along. The window is per ARTIFACT, so a robot
       * genuinely working through a pile keeps its exemption on each new one it meets while
       * the ones it is merely shoving age out of it.
       */
      .filter((m) => m.ahead > 0 && m.hold < C.POSSESSION_CONFIRM + C.POSSESSION_ACQUIRE_S)
      .sort((p1, p2) => p1.ahead - p2.ahead || p1.id - p2.id);
    for (const m of mouth) {
      if (room <= 0) break;
      held.delete(m.id);
      excused.add(m.id);
      conducts.add(m.id); // the rollers own it; the pile behind is still pressed on the robot
      room--;
    }
  }

  /**
   * ...AND CARVE-OUT C: THE LOADING ZONE, scoped the way the rule scopes it.
   *
   * "inadvertent contact with a SCORING ELEMENT while attempting to acquire a SCORING ELEMENT
   * FROM THE LOADING ZONE". The exemption is about a robot IN there collecting its restock, so
   * that is the test. It used to key on the ARTIFACT's position alone, which is a different
   * rule and a worse one in both directions: a robot parked OUTSIDE the zone reaching in and
   * holding a pile was excused, and the whole 23x23 corner became a control-free sanctuary the
   * manual does not grant — G432.D settles that outright by describing an ARTIFACT whose
   * "CONTROL begins when the ROBOT is in the LOADING ZONE" and which "is still CONTROLLED by
   * the ROBOT when the ROBOT leaves", so CONTROL demonstrably applies in there.
   *
   * Carrying one OUT is therefore control again, correctly, and always was.
   */
  if (home && robotInZone(r, home)) {
    for (const b of loose) {
      // unconditionally, NOT just the ones already held: the artifact the robot has not got a
      // grip on yet still has to be excused, or the CHAIN reaches it through one that is and
      // the carve-out leaks. That is exactly how the restock row fouled — one of the three was
      // on a flank with no push behind it, so it was never in `held`, never excused, and came
      // straight back in as a chain member off the two beside it.
      if (inRect(b.pos, home)) {
        held.delete(b.id);
        // NOT added to `conducts` — see its declaration. A robot standing in its own loading
        // zone is not controlling the human player’s restock cluster through the one artifact
        // it happens to be against.
        excused.add(b.id);
      }
    }
  }

  /**
   * ...THEN THE CHAIN, because CONTROL "requires contact with a ROBOT, either directly or
   * TRANSITIVELY through other SCORING ELEMENTS". The transitive half asks for CONTACT and
   * nothing else — an artifact three deep in a shoved wedge is controlled because it is
   * pressed against one that is, however much it rolls on the way.
   *
   * An EXCUSED artifact CONDUCTS but is not COUNTED. Both halves matter and they used to be
   * wrong in opposite directions. It used to be counted anyway — the chain simply re-added
   * every artifact the mouth exemption had just removed, which is the same number with extra
   * steps. Making it neither went too far the other way: severing the chain at the mouth means
   * a robot nosing into a six-clump controls NOTHING, because the only artifacts touching it
   * are the excused ones and nothing behind them can be reached. The exemption is about what
   * you are CHARGED for; it cannot repeal the physical fact that the pile behind is pressed
   * against the robot through the artifact in the mouth.
   */
  /**
   * ⚠️ **THE CHAIN MAY ONLY BE SEEDED BY SOMETHING THE ROBOT IS ACTUALLY TOUCHING.**
   *
   * Measured on the shipped 2v2 replay `dsim-decode-s4-v2`: a blue robot PARKED in its own
   * loading zone, hopper full, with ZERO established holds on anything, was credited with
   * controlling TWELVE artifacts. One artifact lay in the zone, the carve-out excused it,
   * `excused` seeded this flood-fill, and the chain then ran through the human player’s
   * restock cluster — so every artifact piled behind one the robot merely stood beside
   * counted. That single tick billed NINE MINORs and a yellow card, and the mechanism
   * accounts for all 26 G408 MINORs in that match across nine bursts, predicted exactly.
   *
   * A robot that has not touched an artifact is not controlling it, whatever is piled next to
   * it. Seeds are therefore what is HELD, plus the CONDUCTING excused ones it is against.
   */
  const reached = new Set(held);
  for (const id of conducts) if (touching.has(id)) reached.add(id);
  for (let grew = true; grew; ) {
    grew = false;
    for (const b of loose) {
      if (reached.has(b.id)) continue;
      for (const o of loose) {
        if (!reached.has(o.id)) continue;
        // the two SKINS meeting, which is the sum of the two radii — one flat `chain` is only
        // right for a game whose elements are all one size.
        if (hyp(b.pos.x - o.pos.x, b.pos.y - o.pos.y) <= rad(b) + rad(o) + C.POSSESSION_CONTROL_MARGIN) {
          reached.add(b.id);
          grew = true;
          break;
        }
      }
    }
  }
  let controlled = 0;
  for (const id of reached) if (!excused.has(id)) controlled++;
  return r.hopper.length + controlled;
}

/** the ESCAPE direction for a pin: the unit vector from the pinner to the pinned
 * robot, i.e. the way the victim would have to go to get out. Null when the two are
 * coincident, where "away" is undefined. */
function escapeDir(pinner: RobotState, pinned: RobotState): { x: number; y: number } | null {
  const dx = pinned.pos.x - pinner.pos.x;
  const dy = pinned.pos.y - pinner.pos.y;
  const d = hyp(dx, dy);
  if (d < 1e-3) return null;
  return { x: dx / d, y: dy / d };
}

/**
 * Is this point inside something a robot cannot drive through? — `PinSolid`, the one thing
 * `pinnedAgainstWall` needs to know that is not the same in every game.
 *
 * A game whose field is not DECODE's supplies its own; absent, the test below uses DECODE's,
 * which is where DECODE's rules live by design (see CLAUDE.md's note that `src/sim/` IS
 * DECODE's rules). The probe point is a FIELD point, not a robot, so the predicate is pure
 * geometry and a game can answer it from its own colliders.
 */
export type PinSolid = (p: Vec2) => boolean;

/**
 * Is `pinned` trapped against a SOLID with `pinner` on the open-field side?
 *
 * True when the pinned robot's leading corner (straight AWAY from the pinner) sits
 * within PIN_WALL_SLOP of something it cannot drive through — i.e. it cannot retreat
 * from the pinner. This is what distinguishes the aggressor from the victim in a
 * shove where both robots are slow and both are commanding motion.
 *
 * "Solid" means every solid, not just the perimeter. The old test accepted the field
 * wall alone, so a robot held against a GOAL WEDGE or a CLASSIFIER CHANNEL — the two
 * corners of the field where pinning actually happens, since that is where everyone
 * is trying to score — was never recognised as pinned at all.
 *
 * ⚠️ AND "EVERY SOLID" IS PER GAME, which is why `solid` is a parameter. Read against
 * DECODE's tables on another game's field the test is wrong in BOTH directions at once:
 * it reports a solid in the two corners where DECODE keeps its goals and that game keeps
 * open floor — cancelling a real pin, since a cornered robot is ESCAPING and never PINNING —
 * and it reports open floor wherever that game's own structures actually stand. On BIOBUZZ
 * that is the four FLOWER feet and the two HIVE frame bars, i.e. most of where a pin happens.
 */
function pinnedAgainstWall(pinner: RobotState, pinned: RobotState, solid: PinSolid): boolean {
  const e = escapeDir(pinner, pinned);
  if (!e) return false;
  let reach = 0;
  for (const c of robotCorners(pinned)) {
    reach = Math.max(reach, (c.x - pinned.pos.x) * e.x + (c.y - pinned.pos.y) * e.y);
  }
  const p = {
    x: pinned.pos.x + e.x * (reach + C.PIN_WALL_SLOP),
    y: pinned.pos.y + e.y * (reach + C.PIN_WALL_SLOP),
  };
  return solid(p);
}

/**
 * The world-frame direction a robot is TRYING to translate, or null if it is not asking to
 * translate at all. Mirrors `updateRobot`'s own command decode, because "attempting to move"
 * has to mean the same thing to the referee as it does to the drivetrain.
 *
 * TANK IS WHY THIS IS A FUNCTION. A tank (or a butterfly on its traction set) is commanded as
 * SIDE-DRIVE, and the old test read only `driveX`/`driveY`/`rotate` — which a Traditional-tank
 * driver on separate sticks never fills. Such a robot was never "attempting to move", so it
 * could not be pinned at all: G422 simply did not protect it.
 */
function attemptDir(r: RobotState, cmd: RobotCommand | undefined): Vec2 | null {
  if (!cmd) return null;
  // `driveIntent` (physics.ts) is the one decode of a stick into a world-frame heading -
  // tank's two side-drives, a field-centric stick with only the camera undone, exactly as
  // `updateRobot` reads them. This rule needs only the DIRECTION.
  const world = driveIntent(r, cmd);
  const m = hyp(world.x, world.y);
  return m > 0.1 ? { x: world.x / m, y: world.y / m } : null;
}

/**
 * Is `pinner` PINNING `pinned` right now?
 *
 * G422: "A ROBOT is PINNING if it is preventing the movement of an opponent ROBOT by contact,
 * either direct or transitive (such as against a FIELD element) and the opponent ROBOT is
 * attempting to move."
 *
 * Three clauses are the rule's own. The fourth — `pinnedAgainstWall` — is the sim standing in
 * for a referee; see PIN_WALL_SLOP for why something has to break the symmetry of a shove, and
 * what leaving it in costs.
 */
export function isPinning(
  pinner: RobotState,
  pinned: RobotState,
  contact: boolean,
  cmd: RobotCommand | undefined,
  pinnerCmd: RobotCommand | undefined,
  solid: PinSolid,
): boolean {
  if (!contact) return false;
  const e = escapeDir(pinner, pinned);
  if (!e) return false;

  /**
   * THE PINNER HAS TO BE DOING THE HOLDING — and this, not a wall, is what breaks the SYMMETRY
   * of a shove.
   *
   * `pinnedAgainstWall` used to be a hard requirement, kept (it is NOT in the rule — a FIELD
   * element is an example, "such as") precisely because it was the only thing telling the
   * aggressor from the victim when two robots are leaning on each other. But it also meant a
   * pin in OPEN FIELD drew nothing at all, which is not what the rule says and not what a
   * referee calls: reported as "pinning penalty should happen without being against the wall."
   *
   * Requiring the pinner to be DRIVING INTO its victim does the same job directly. Two robots
   * shoving head-on both satisfy it, which makes the pin mutual, and criterion C already
   * throws a mutual pin out as nobody's foul — so the stalemate the wall test existed to
   * exclude is still excluded, by the clause that is actually about it. What it no longer
   * excludes is the ASYMMETRIC case: one robot driving into another that is trying to get away
   * across open floor, which is a pin by every word of the rule.
   *
   * `rrContacts` is recorded on geometric OVERLAP ALONE (physics.ts), so contact by itself says
   * nothing about who is holding whom; without this, an incidental lean would bill a MINOR
   * every 3 s.
   */
  const push = attemptDir(pinner, pinnerCmd);
  if (!push || push.x * e.x + push.y * e.y < C.PIN_PRESS_COS) return false;

  /**
   * ...AND A ROBOT CORNERED AGAINST A SOLID IS ESCAPING, NOT PINNING.
   *
   * Without this, dropping the wall requirement quietly cancelled every wall pin there is. The
   * victim held against a wall pushes BACK into its pinner, which is pressing toward it — so
   * the reverse direction also read as a pin, criterion C called the pair mutual, and the whole
   * thing was thrown out as nobody's foul. Measured: sixteen existing checks went to zero.
   *
   * The wall test used to prevent that as a side effect (the pusher is not against anything, so
   * the reverse never qualified). Stated directly it is a better rule than the one it replaces:
   * a robot with a solid at its back and an opponent at its front is the one being HELD, and
   * pressing toward the opponent is the only way out. That is escaping. It cannot also be the
   * pinning.
   *
   * Two robots meeting in open floor are both free to leave, so both still qualify, and
   * criterion C throws that out as the mutual shove it is.
   */
  if (pinnedAgainstWall(pinned, pinner, solid)) return false;

  /**
   * A VICTIM DOES NOT HAVE TO BE STRUGGLING TO BE PINNED.
   *
   * The rule's own words are "and the opponent ROBOT is ATTEMPTING TO MOVE", and reading that
   * as "the victim's stick is deflected this tick" is what kept the foul rare: a driver who is
   * held stops mashing the stick — they line up a shot, they wait for their partner, they give
   * up — and the pin stopped counting the moment they did. A referee cannot see a stick; what
   * they see is one robot holding another, and they call it either way.
   *
   * ⚠️ A DEVIATION from the rule as written, in the same class as `POSSESSION_REBILL_S`.
   */
  const want = attemptDir(pinned, cmd);
  if (!want) return true;

  /**
   * ...and the ONE case still excluded: a robot driving ITSELF into something it cannot pass.
   * It satisfies contact, attempting to move and going nowhere, while the opponent behind it
   * prevents nothing — measured, the WEAKEST legal build "pinned" a default chassis that way.
   *
   * THIS TEST ONLY MEANS ANYTHING WHEN THERE IS A TRAP. `escapeDir` points from the pinner to
   * the victim, so `want` agreeing with it is a robot pressing further into whatever is behind
   * it — but only if something IS behind it. In open field that same direction is the genuine
   * escape, straight away from the pinner, and excluding it would throw out the very case this
   * change exists to catch. So it is asked only when the victim really is against a solid.
   *
   * Note it deliberately does NOT ask whether the pinner lies along `want`: that is true of a
   * straight reverse and false of every SIDEWAYS exit, so it ruled out the ordinary wall pin
   * (measured: a victim welded to the wall billed ZERO). Whether an escape SUCCEEDS is measured
   * afterwards by `PIN_STUCK_SPEED` and criteria A/B — prevention is an outcome, not a stick
   * direction.
   */
  if (!pinnedAgainstWall(pinner, pinned, solid)) return true;
  return e.x * want.x + e.y * want.y < C.PIN_INTO_TRAP_COS;
}
