/**
 * BFSIM mark — a PLACEHOLDER "BF" monogram on a navy badge. Self-contained (literal
 * colors, one gradient) so the same artwork doubles as `public/favicon.svg` — a
 * favicon file can't read the `--ds-*` vars, so these hexes are deliberate. Keep the
 * two files in sync. Scales crisply from a 20px header chip up. `aria-hidden` — the
 * wordmark beside it carries the name.
 */
export function Logo({ size = 24, radius = 7 }: { size?: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="bfsimGrad" x1="0" y1="0" x2="0" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#244a7a" />
          <stop offset="1" stopColor="#142848" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx={radius} fill="url(#bfsimGrad)" />
      <g stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {/* B */}
        <path d="M7 8v16M7 8h5.2a3.4 3.4 0 0 1 0 6.8H7M7 14.8h5.8a3.6 3.6 0 0 1 0 7.2H7" />
        {/* F */}
        <path d="M19 24V8h6.5M19 15.5h5" />
      </g>
    </svg>
  );
}
