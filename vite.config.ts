import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// a stable build id (git sha, timestamp fallback) baked into the client AND emitted
// to /version.json, so a running client can detect that a newer build has deployed.
const BUILD_ID = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return String(Date.now());
  }
})();

/**
 * The Contributors page's third-party credit table cites a package VERSION next to its
 * name, and a hand-typed one drifts the first time `package.json` bumps without anyone
 * remembering the credits page. Read once here (the same `readFileSync` + `JSON.parse`
 * `scripts/smoke.ts` already uses for a package.json check) and baked in as a build-time
 * constant, the same technique as `__BUILD_ID__` above: `src/contributors.ts` never touches
 * the filesystem itself, and its `declare const` falls back to a literal if this is ever
 * absent (a non-Vite consumer), matching `net/version.ts`'s `__BUILD_ID__` guard.
 */
const THIRD_PARTY_VERSIONS = (() => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const versionOf = (name: string): string =>
    (pkg.dependencies[name] ?? pkg.devDependencies[name] ?? '').replace(/^[\^~]/, '');
  return {
    rapier2d: versionOf('@dimforge/rapier2d-compat'),
    rapier3d: versionOf('@dimforge/rapier3d-deterministic-compat'),
    three: versionOf('three'),
    react: versionOf('react'),
    plusJakartaSans: versionOf('@fontsource-variable/plus-jakarta-sans'),
    spaceGrotesk: versionOf('@fontsource-variable/space-grotesk'),
  };
})();

// BFSIM bakes NO server or auth address into any build. The Electron build used to inject the
// original project's game-server list and Neon Auth URL here; both are gone, so a build only
// talks to a server when you set VITE_GAME_SERVER_URL / VITE_GAME_SERVERS (and VITE_NEON_AUTH_URL
// for accounts) yourself. With none set the app is fully offline, and LAN play still works.

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ build: BUILD_ID }),
        });
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __THIRD_PARTY_VERSIONS__: JSON.stringify(THIRD_PARTY_VERSIONS),
  },
  /**
   * WORKERS ARE BUILT AS ES MODULES, because the LAN host worker code-splits.
   *
   * Vite's default is `'iife'`, and an IIFE bundle cannot be code-split — the first dynamic
   * `import()` anywhere in a worker's graph fails the build outright with
   * `Invalid value "iife" for option "worker.format"`. `src/lan/hostWorker.ts` hosts the
   * authoritative room in a tab and calls `initPhysics3d()` for a 3D BIOBUZZ room, which
   * reaches the ~1.1 MB rapier3d wasm through exactly such an import. The alternative —
   * importing the package statically — would put that megabyte in the worker chunk for every
   * host, including the 2D ones, which is the cost the lazy load exists to avoid.
   *
   * This is not a new runtime requirement: `hostRuntime.ts` already constructs the worker with
   * `{ type: 'module' }`, so the only thing that was out of step was the BUILD format. Module
   * workers are supported everywhere BFSIM hosts from (Chromium — and therefore Electron —
   * since 80, Safari 15, Firefox 114).
   */
  worker: { format: 'es' },
  // Absolute base for the WEB build so path-based routes (/leaderboard, /replay/…)
  // still resolve assets on a deep load / refresh (paired with the vercel.json SPA
  // rewrite). The Electron desktop build sets ELECTRON=1 (see the `dist` script) to
  // keep the relative base needed under file:// — it routes by state, not URL.
  base: process.env.ELECTRON === '1' ? './' : '/',
  // Vite 6 only answers requests whose Host header is localhost (DNS-rebinding
  // protection). A Cloudflare quick tunnel forwards the browser's request with the
  // tunnel hostname as Host, so without this every tunnelled page load is a 403
  // "Blocked request. This host is not allowed". The leading dot matches every
  // random quick-tunnel subdomain, so a fresh tunnel never needs a config edit.
  server: { allowedHosts: ['.trycloudflare.com'] },
  preview: { allowedHosts: ['.trycloudflare.com'] },
});
