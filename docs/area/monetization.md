<!-- governs: server/kofi.ts, src/ui/EntitlementsProvider.tsx, src/legalText.ts, src/analytics.ts, src/analyticsPref.ts, src/pageviews.ts, src/pathScrub.ts, src/storageKeys.ts, server/analytics.ts, server/analyticsImport.ts -->
# Monetization — REMOVED in this fork; analytics, privacy and the storage registry remain

BFSIM has **no ads, no payments and no paid tier**. This file keeps what is still true (analytics,
the privacy text, the storage registry) and records what was taken out, so nobody re-adds it by
accident.

*Split out of `CLAUDE.md` on 2026-09-16, **verbatim** — CLAUDE.md is loaded into every
session and this is not needed by most of them. The `governs:` line above is read by
`scripts/docaudit.mjs` and by the editor hook, so keep it accurate when paths move.*

---

## What was removed (BFSIM, 2026-10-14) and what was kept

- **Ads are gone.** `src/ads/` (the AdSense loader, consent tool and provider), `AdSlot`, the
  `ads.txt`/verification plugins in `vite.config.ts`, the hard-coded AdSense tag in `index.html`
  (it carried the ORIGINAL author's publisher id) and the `.game-ad`/`.ad-slot`/`.menu-ad` CSS no
  longer exist. Nothing may re-add an ad tag: it would earn for whoever's id it carries.
- **The Ko-fi webhook, claim route and `/api/pricing` are gone** from `server/api.ts`; the Donate
  page, the Membership panel and the footer "Support" link with them. `server/kofi.ts` (a pure
  policy module) and the `repo.ts` grant/claim functions are KEPT as dormant plumbing, so the
  migrations, `dbtest` and an admin grant still work. A payment can no longer arrive.
- **Supporter perks are free for everyone.** `cosmeticAllowed` allows `free` AND `supporter`-tier
  keys (only `earned` keys are gated) and `savedStartCap` always returns the larger cap
  (`MAX_SAVED_STARTS_SUPPORTER`). The server enforces through the same shared functions, so a
  client and the server agree. The `supporter` flag, `supporter_until` and the badge component
  still exist, and nothing reads them as a gate.
- **`EntitlementsProvider`** (`src/ui/EntitlementsProvider.tsx`, was `AdsProvider`) still fetches
  the account's EARNED cosmetic unlocks; `useEntitlements()` replaces `useAds()`.
- **Legal text** (`src/legalText.ts`) is rewritten for a noncommercial fork: no operator
  jurisdiction, no memberships, no advertising section, and the contact is the repository's issue
  tracker (`LEGAL_CONTACT`, a URL, not an email). `LEGAL_UPDATED` is 2026-10-14, so a signed-in
  account is asked to accept once. `LEGAL_VERSION` is DERIVED from `LEGAL_UPDATED`
  (`legalVersionOf`); moving the date prompts every signed-in account to accept again.
- ⚠️ **The sponsor slot is NOT monetization here**: it reads "BF Robotics" with placeholder
  artwork (`docs/area/sponsor.md`).
- **Not removed:** first-party analytics (below). It runs only with `VITE_ANALYTICS=1` and a
  connected server, so an offline or LAN build sends nothing.

- **FIRST-PARTY ANALYTICS — the admin console's Analytics tab.** BFSIM measures itself now
  (`server/analytics.ts`, migration `0042`, `src/pageviews.ts`, `src/ui/AdminAnalytics.tsx`),
  and since September 2026 ONLY itself: the host's analytics script was dropped once the tab
  covered everything it showed. The first reason to build it was the thing a third party structurally
  cannot do is put traffic beside the PRODUCT tables — matches per game × mode × physics,
  signups, D1/D7/D30 retention, the ranked distribution, replay storage, moderation load,
  Ko-fi conversions. Every one of those is a query over tables that already existed; the
  feature added no column to any of them.
  - **COLLECTED, per page view**: the scrubbed path, the game, the referrer's HOST, the three
    UTM parameters, a two-letter country, device/OS/browser family, a screen BUCKET
    (`sm`/`md`/`lg`/`xl`), the primary language subtag, `web`/`electron`, the release channel
    and the build id. Named events land beside them with at most four bounded properties.
  - ⚠️ **NEVER COLLECTED, and this is a SCHEMA guarantee rather than a discipline**: no IP
    address, no full user agent, no account id, no exact viewport, no click or input. `dbtest`
    asserts against `information_schema` that no `analytics_*` table has such a column, because
    a column somebody adds later for a good reason is exactly how this would be lost.
  - **THE VISITOR KEY IS `sha256(daily salt || ip || ua || site)` truncated to 16 hex**, and
    the salt is DESTROYED at two days (`analytics_salt`). That deletion is the guarantee: past
    it, nobody can recompute yesterday's hash from an address. The consequence is stated on the
    dashboard and in the policy rather than hidden — **a visitor count over a range is a SUM OF
    DAILY UNIQUES**, and the same person on two days is two visitors. Sessions are DERIVED in
    SQL from a 30-minute gap; there is no session identifier to store.
  - **COUNTRY** comes from `fly-client-country` (or `cf-ipcountry` / `x-vercel-ip-country`)
    when the edge sets one, else from the browser's coarse IANA timezone mapped by a table in
    `server/analytics.ts`. The timezone string is used for that line and discarded. **Never a
    third-party geo-IP service.**
  - **SCRUBBING HAPPENS ON THE CLIENT**, in `normalizePath`: the query string goes
    unconditionally (`?token=` is how a password reset arrives) and `/replay/<id>`,
    `/profile/<name>` and room codes become placeholders, so an id never leaves the browser.
    `npm test` exercises the scrubbers headlessly, which is why `src/pageviews.ts` reads
    `import.meta.env` through a guard and reaches `net/env` by dynamic import.
  - **RETENTION**: raw rows 30 days, `analytics_hourly` 35 days, `analytics_daily` kept,
    `analytics_concurrency` 120 days, the salt 2 days. The rollup and the sweep run on a
    five-minute interval under `pg_try_advisory_lock`, so exactly one Fly machine does the
    work — and the interval is **started by the first beacon**, never at boot, because Neon
    bills the wall-clock time the compute is awake and an unconditional timer costs the month.
  - **GATES**: `VITE_ANALYTICS=1` **and** a configured cloud game server, plus
    `analyticsAllowed()` (the in-app switch). Browser `doNotTrack`/GPC do NOT gate it (owner,
    2026-09-25: count all traffic; no identifier, first-party only). A self-hosted, LAN or offline build sends
    nothing. The ingest route needs `DATABASE_URL` on the Fly side and nothing else.
  - **The dashboard is a LAZY chunk** and is gated on `isStaffUser` — `profiles.role`, the
    projection of `ADMIN_USER_IDS`, not a second env read. A range inside the raw window is
    exact and cross-filterable; one reaching further back is served from the daily rollups and
    the panel SAYS so rather than silently degrading. Events and their properties are rolled
    up too (`dim = 'event'` / `'evprop'`, val `name|key|value`), so a month-old sponsor report
    still breaks down by placement. The **Sponsor report** panel lays out `docs/sponsor.md`'s
    lines; the **Last month** range is the report period.
  - **VERCEL HISTORY IS FOLDED IN, ONE SOURCE PER DAY.** `analytics_imported` (0053) holds Vercel
    Web Analytics' daily aggregates from before it was removed, loaded by
    `scripts/vercel-analytics-export.mjs` + `scripts/import-vercel-analytics.ts` (dry run unless
    `--write`; replaces the file's days, so re-runs are safe; a preview export is stored as
    `vercel-preview`). Paths go through `normalizePath` on import. The READ decides, in
    `server/analytics.ts` (`importContext`, `importWindow`, `importMode`):
    - **The boundary is derived from the data.** `ownFirst` = the earliest day our own tables
      hold traffic on the import's channel (`vercel` = `stable`, `vercel-preview` = `alpha`). That
      day is partial (the pipeline was switched on during it), so if the import holds it too, ours
      starts the day after (`ownFrom`); if not, ours starts on it. Days before `ownFrom` are
      read from the import, days from it on from ours. **Imported rows on or after `ownFrom` are
      never read** — never a sum on the overlap. Loading overlapping days is harmless.
    - **Folded into** the tiles (views, visitors), the chart, every breakdown the import has
      (pages, referrers, countries, devices, OS, browsers, UTM if present; its "Others" row shows
      as "Other"), the channel and surface panels (imported rows count as `stable`/`alpha` +
      `web`), events and their properties, and so the sponsor report. Top N is taken AFTER the
      sum. Visitors are a sum of daily uniques on both sides.
    - **Ours alone:** sessions, bounce rate, session length, entry pages, screen, language, build,
      online now. The page says "from Sep N" beside them when the range reaches imported days.
    - **Filters:** a game pick leaves imported days out (no game split). A channel/surface chip
      keeps them if it names what they are, else leaves them out. ONE chip on a dimension the
      import has is answered from that breakdown's row (totals, chart, that panel); two such
      chips, or a chip on screen/language/build, leave them out. Events ignore chips on both
      sides. The note under the range says which applies (`history` in the response).
    - Imported days are whole UTC days: range ends round to the nearest midnight, and an hourly
      range that reaches them is returned by day (`grain`). The chart marks the boundary.
    - `imported` stays in the response as `null` so a pre-change admin page does not break.
  - **`LEGAL_UPDATED` moved to September 25, 2026** (owner) for first-party analytics, the host's
    count removed and browser DNT/GPC no longer gating it: every signed-in account accepts once.
- Analytics events (`src/analytics.ts`, `VITE_ANALYTICS=1`, cookieless, one sink: our own).
  **Rule: no identifiers in any event payload** — counts and enums only.
  It has an **OFF SWITCH**, `src/analyticsPref.ts`, read by `trackEvent` on EVERY call
  (not cached: it is an opt-OUT, so a second tab turning it off must stop a session already
  running). DEFAULT ON, and storage that THROWS answers on — failing closed would mute every
  locked-down browser and bias the numbers the sponsor report is read off. It lives in its own
  leaf module because `analytics.ts` reads `import.meta.env` at module scope and therefore
  cannot be imported from `scripts/smoke.ts` at all.

---

## Privacy: the storage registry, "Your data", and the export

Built on branch `feat/privacy-cookies` for roadmap item 8.

- ⚠️ **`src/storageKeys.ts` IS THE ONLY PLACE A `decodesim.` KEY MAY BE WRITTEN DOWN**, and
  `npm test` enforces exactly that: no such literal anywhere in `src/` outside that file
  (comments stripped), every storage call site naming its key by identifier or a documented
  `…Key(id)` accessor, every file touching storage importing from the registry, and no dead
  entries. It exists because `PRIVACY_MD` used to enumerate the keys in prose and had drifted
  to FOUR names that did not exist plus SEVEN keys missing — undetectable by reading, because
  the list and the code were different files.
- **`PRIVACY_MD` NAMES NO KEY, and must not start again.** It describes the three categories
  (`necessary` / `preference` / `analytics`) and points at the live table, which
  `src/ui/YourData.tsx` renders off `STORAGE_KEYS`. The `analytics` group is printed EMPTY
  on purpose: "none" is the most reassuring line on the page and it stays true by construction.
- **ONE LITERAL LIVES OUTSIDE THE REGISTRY**: `index.html`'s blocking theme stamp, which runs
  before any module loads. A smoke check pins it to `THEME_KEY`.
- ⚠️ **THE FOOTER CONSENT LINK MUST NEVER DELETE ITSELF.** `ConsentLink` used to `return null`
  once `showConsentSettings()` answered false — the NORMAL case outside the EEA/UK/CH — so the
  one control the privacy policy names by name vanished for most of the world. It now falls back
  to `/privacy#your-data`, where the row says why no dialog opened. A smoke check greps for the
  early return coming back.
- **`GET /api/user/export`** (`exportAccount` in `server/db/repo.ts`, written NEXT TO
  `deleteAccount` so a table added to one list and not the other is one screenful apart).
  Rate-limited to **one per minute per account** — seventeen queries on compute that bills by
  the minute. **Only rows keyed to the caller**, plus a match's own facts: the other players in
  a versus match are absent entirely, and `dbtest` asserts that against the SERIALIZED
  document, because the leak to fear is a join somebody adds later for a good reason. Replay
  BODIES are out (ids and metadata only); no email address is selected at all. A missing profile
  row is a **404**, which is what a just-deleted account gets.
- ⚠️ **AN OLD SERVER ANSWERS `/api/user/export` WITH A 200.** That path also matches the older
  build's `/api/user/<id>` profile route, which cheerfully reports a profile for the user id
  `"export"`. One Fly app serves every client version, so `fetchMyExport` guards on the
  payload (`format`), not on the status — handing that object to somebody as their personal
  data would be the worst failure this route has available to it.
- **`DeleteAccount` is ONE component rendered in two places** (Profile and "Your data"). The
  typed confirmation and the paragraph about what SURVIVES a deletion are the load-bearing
  parts; two copies of that copy would drift.

---

