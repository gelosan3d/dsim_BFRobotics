

/**
 * ROBOT COSMETICS — 2D SHARED HELPERS (`docs/cosmetics-plan.md` §3.4). Used by all three 2D
 * sprites (DECODE here, CR/BIOBUZZ import them), so the halo, the decal shapes and the accent
 * tint are drawn identically everywhere instead of drifting per game.
 *
 * `RobotSpec.accent`/`decal`/`plate` are landing on a parallel lane (`src/types.ts`); read them
 * through `clampCosmetics`, which is shape-safe on a spec that does not declare them yet (every
 * field is optional, so an object missing them entirely is already a valid `Cosmetics`) — no cast
 * needed, and no renderer here has to wait on the type before drawing the fields it names.
 */

/**
 * THE ROBOT'S EDGE LINE — NEUTRAL, NOT THE ALLIANCE'S (owner, 2026-09-21: "Remove the red/blue
 * alliance outline. For multiplayer, display people's username in the color of their alliance").
 * Every STROKE on a sprite (the chassis silhouette, the wheels, the intake members) takes this;
 * the alliance now lives on the name label over the robot (`render/renderer.ts`), the sign
 * placard and the heading chevron, which are FILLS. A machined-aluminium grey: 5.9:1 on the mat,
 * so a charcoal chassis still has an edge, and it needs no dark halo under it the way a red line
 * on a red fill did (the halo is gone with the outline it existed for).
 */
export const ROBOT_TRIM = '#9aa3ad';

/** blend `accent` into a structural `base` colour by `amt` (0..1) and an optional alpha — used to
 * tint an aluminium/rubber part (a tread bar, a roller stripe) with the cosmetic accent without
 * losing the material shading that says "this is rubber", not painting it flat. */
export function tintColor(base: string, accent: string, amt: number, alpha = 1): string {
  const b = hexToRgb(base);
  const a = hexToRgb(accent);
  if (!b || !a) return base;
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amt);
  return `rgba(${mix(b.r, a.r)},${mix(b.g, a.g)},${mix(b.b, a.b)},${alpha})`;
}
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * FIVE-POINTED STAR VERTICES — the one place the shape is defined, read by `drawDecal`'s
 * `'star'` case here, the BIOBUZZ 3D decal texture (`games/biobuzz/scene/renderRobots.ts`,
 * different coordinate convention, same helper) and the builder's SVG swatch (`ui/Menu.tsx`),
 * instead of ten vertices hand-listed three times over. Standard math angle convention (0 = +x,
 * increasing counter-clockwise); `points` alternates an outer vertex and an inner notch every
 * `pi/points`, starting on an OUTER vertex at `startAngle` — so a caller that wants "forward" to
 * be the tip just passes the angle that means forward in ITS frame.
 *
 * `STAR_INNER_RATIO` is `1/phi^2` (`(3-sqrt(5))/2`, ~0.382): the ratio a regular pentagram's
 * own edges converge to if extended, not a rounder ~0.5 that reads as a five-petaled flower
 * rather than a star at decal size.
 */
export const STAR_INNER_RATIO = (3 - Math.sqrt(5)) / 2; // 1/phi^2 ~= 0.381966

export function starPoints(cx: number, cy: number, outerR: number, startAngle: number, points = 5): [number, number][] {
  const innerR = outerR * STAR_INNER_RATIO;
  const step = Math.PI / points; // half the angle between two outer vertices
  const out: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = startAngle + i * step;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** trace a closed `starPoints` polygon into the current path (no fill/stroke — the caller's
 * job, same as `roundRect`/`body` elsewhere in this file). */
function traceStar(ctx: CanvasRenderingContext2D, pts: readonly [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/**
 * THE DECAL — a vector shape over the chassis fill, under the halo/outline, parametric in the
 * FOOTPRINT (fractions of length/width, never absolute inches — a decal must scale to any legal
 * chassis, the risk `docs/cosmetics-plan.md` §4 names). Called with the caller's already
 * translated+rotated, footprint-clipped context, `hl`/`hw` the chassis half-length/half-width.
 */
export function drawDecal(ctx: CanvasRenderingContext2D, hl: number, hw: number, decal: string, accent: string): void {
  if (decal === 'none') return;
  const L = hl * 2;
  const W = hw * 2;
  ctx.fillStyle = accent;
  switch (decal) {
    case 'stripe': {
      // one centre stripe, front to back, 18% of the width
      const w = W * 0.18;
      ctx.fillRect(-hl, -w / 2, L, w);
      break;
    }
    case 'racing': {
      // two parallel stripes either side of centre
      const w = W * 0.1;
      const off = W * 0.15;
      ctx.fillRect(-hl, off - w / 2, L, w);
      ctx.fillRect(-hl, -off - w / 2, L, w);
      break;
    }
    case 'chevron': {
      // a forward-pointing chevron across the deck (+x is forward)
      const d = L * 0.22;
      const half = hw * 0.82;
      const notch = d * 0.55;
      ctx.beginPath();
      ctx.moveTo(d * 0.5, 0);
      ctx.lineTo(-d * 0.5, -half);
      ctx.lineTo(-d * 0.5 + notch, -half);
      ctx.lineTo(d * 0.5 + notch, 0);
      ctx.lineTo(-d * 0.5 + notch, half);
      ctx.lineTo(-d * 0.5, half);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'hazard': {
      // diagonal bands, rear third only
      const x0 = -hl;
      const x1 = -hl + L / 3;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, -hw, x1 - x0, W);
      ctx.clip();
      const bw = W * 0.16;
      for (let o = -W; o < L / 3 + W; o += bw * 2) {
        ctx.beginPath();
        ctx.moveTo(x0 + o, -hw);
        ctx.lineTo(x0 + o + bw, -hw);
        ctx.lineTo(x0 + o + bw + W, hw);
        ctx.lineTo(x0 + o + W, hw);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'checker': {
      // a 4-wide checker band across the middle of the deck
      const cols = 4;
      const cw = L / cols;
      const bandH = W * 0.3;
      const rows = Math.max(1, Math.round(bandH / cw));
      const rh = bandH / rows;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          if ((i + j) % 2 === 0) ctx.fillRect(-hl + i * cw, -bandH / 2 + j * rh, cw, rh);
        }
      }
      break;
    }
    case 'star': {
      // A REGULAR star needs the SAME radius on both axes — scaling x by `hl` and y by `hw`
      // separately (the way `chevron` does, fine for an arrow) would squash it into a
      // lopsided diamond on a chassis whose length and width differ a lot, and this sim's
      // legal chassis range does. So the radius is one number, off the SMALLER of the two
      // half-dimensions — the one that actually bounds how big a regular star fits before
      // it clips the footprint — at 0.8x, the same reach toward the edge `chevron` takes at
      // 0.82x hw. `startAngle` 0 puts the first outer vertex on +x: one point forward.
      //
      // ⚠️ THE COST OF ONE RADIUS IS THAT A LONG CHASSIS GETS A SMALLER STAR, AND THAT IS
      // FINE ONLY BECAUSE THE LEGAL RANGE IS NARROW. Measured against the intake presets in
      // `config.ts`: length 11–18, width 14.5–18, so `min(hl, hw)` lands between 5.5 and 9
      // and the star is always a real fraction of the deck. Drawn on an ILLEGAL 40x6 it
      // becomes a speck — true, and not worth designing for; a stress case outside the
      // builder's own clamps is not a chassis this ever renders.
      const r = Math.min(hl, hw) * 0.8;
      traceStar(ctx, starPoints(0, 0, r, 0));
      ctx.fill();
      break;
    }
  }
}

/**
 * Stroke a path so the line lies ENTIRELY INSIDE it.
 *
 * A canvas stroke straddles the path — half its width falls outside — so a chassis drawn at
 * its true length x width renders half a line wider on every side than the box it collides
 * with, and the outline reads as not being part of the robot. Clipping to the path and
 * stroking at double width puts the whole line inside: the drawn silhouette is exactly the
 * collision footprint, and nothing about where the wheels or mechanisms sit changes.
 */
export function strokeInside(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  width: number,
): void {
  ctx.save();
  path();
  ctx.clip();
  ctx.lineWidth = width * 2;
  path();
  ctx.stroke();
  ctx.restore();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
