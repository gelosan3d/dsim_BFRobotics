/**
 * Legal page copy — privacy policy + terms of use.
 *
 * Kept as template-literal strings (the `src/contributors.ts` / `src/download.ts`
 * data-module convention) and rendered by the zero-dep `Markdown` component in
 * `src/ui/markdown.tsx`. Legal renders them with `baseLevel={1}`, so `##` is a real h2 and
 * these documents start at `##`, under the page's own `.ds-h1`.
 *
 * The supported markdown subset is narrow: headings, paragraphs, bullets, **bold**,
 * *italic*, `code`, [links](url), and `---` rules. No tables, no blockquotes, no
 * code fences — keep to that subset or it renders as literal text.
 *
 * ACCURACY IS LOAD-BEARING. The data inventory below was written against the real
 * schema (`server/db/migrations/`). If you add a table, a synced field, or a
 * third-party service, update the matching section — a policy that misdescribes what
 * you collect is worse than no policy at all.
 *
 * ⚠️ THIS FILE NO LONGER NAMES A SINGLE STORAGE KEY, and must not start again. It used
 * to list four of them, and by the time anyone checked, all four names were wrong and
 * seven real keys were missing — because the list and the code were in different files
 * and nothing could tell them apart. The keys now live in `src/storageKeys.ts`, the
 * privacy page renders the table off that registry (`src/ui/YourData.tsx`), and
 * `npm test` fails on a `decodesim.` literal written anywhere else in `src/`,
 * INCLUDING here. The prose below describes the CATEGORIES and points at the table.
 */

/**
 * Last substantive revision — shown on both pages.
 *
 * October 14, 2026 (BFSIM fork): rewritten for a noncommercial fork with no ads, no payments, no
 * operator-held accounts and no governing-law clause. Moving this asks EVERY signed-in account
 * to accept the terms again, once — move it for a material change, never for a typo.
 */
export const LEGAL_UPDATED = 'October 14, 2026';

/**
 * THE SAME REVISION, AS A SORTABLE KEY — what an acceptance is recorded against.
 *
 * DERIVED from `LEGAL_UPDATED` rather than written out beside it, because two hand-kept
 * spellings of one date is a way for the version everybody re-accepts to disagree with the
 * date on the page they are re-accepting. Change the line above and this follows; a smoke
 * check pins the pair so a reformat of the human date cannot silently change the key and
 * prompt every account in the app for nothing.
 *
 * ⚠️ A CHANGE HERE MAKES EVERY SIGNED-IN ACCOUNT ACCEPT AGAIN, once (see
 * `termsGateState` and `src/ui/TermsGate.tsx`). That is the point of it — continued use
 * after a material change has to be a decision somebody made — so move it when the terms
 * materially change and not for a typo.
 */
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * `'August 4, 2026'` → `'2026-08-04'`. Parsed by hand rather than with `new Date()`:
 * that constructor is implementation-defined for a non-ISO string, and this value keys a
 * database column on five machines in different regions.
 *
 * An unparseable date falls back to the string itself, lowercased with the spaces
 * squeezed out — still stable, still unique per revision, just uglier. A legal gate must
 * not be able to throw at module load.
 */
export function legalVersionOf(updated: string): string {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(updated.trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return updated.trim().toLowerCase().replace(/\s+/g, '-');
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** the revision an acceptance is stored as (`profiles.terms_version`, migration 0040) */
export const LEGAL_VERSION = legalVersionOf(LEGAL_UPDATED);

/**
 * SHOULD THIS ACCOUNT BE ASKED TO ACCEPT THE TERMS? A pure function, so the one rule
 * that decides whether a blocking dialog appears is testable without a browser, a
 * session or a database (`npm test` covers all four answers).
 *
 *   `undefined` ⇒ **unknown**, and it does NOT block. The version rides along with the
 *     entitlements fetch, which never throws and answers nothing at all against a server
 *     older than the route — one Fly app serves every client version. A gate that blocked
 *     on "not told" would put an un-dismissable dialog in front of every player the
 *     moment that route hiccuped.
 *   `null` ⇒ **never** accepted. This is the Google-OAuth first session and every account
 *     that predates the checkbox: they have to accept once.
 *   a different string ⇒ **stale**. The terms changed; accept the new ones.
 *
 * A recorded version NEWER than this build’s is `stale` too, deliberately: it means a
 * client is running behind the deployed legal text, and asking again is harmless where
 * guessing which way time runs is not.
 */
export type TermsGateState = 'ok' | 'unknown' | 'never' | 'stale';

export function termsGateState(
  recorded: string | null | undefined,
  current: string = LEGAL_VERSION,
): TermsGateState {
  if (recorded === undefined) return 'unknown';
  if (recorded === null || recorded === '') return 'never';
  return recorded === current ? 'ok' : 'stale';
}

/** the two states that put a dialog in front of somebody */
export const termsGateBlocks = (s: TermsGateState): boolean => s === 'never' || s === 'stale';

/** where privacy / data-deletion requests go: this fork has no mailbox, so it is the issue tracker */
export const LEGAL_CONTACT = 'https://github.com/gelosan3d/dsim_BFRobotics/issues';

/**
 * WHO the terms are with. BFSIM is a noncommercial team fork, not a service run by a company:
 * the "operator" is whoever runs a given copy, and the terms say so. There is no governing-law
 * clause (the jurisdiction is deliberately empty), because a school-team practice tool that
 * charges nothing has no counterparty to litigate against.
 */
export const LEGAL_OPERATOR = 'BF Robotics';
export const LEGAL_JURISDICTION = '';

/** true once an operator is named. The Terms page shows a visible warning while this is false. */
export const LEGAL_IDENTIFIED = LEGAL_OPERATOR.trim() !== '' && !LEGAL_OPERATOR.startsWith('[');

export const PRIVACY_MD = `
BFSIM is a free, noncommercial FTC driver-practice simulator. This page says what it keeps and
where. There is no advertising and no payment system in this fork, and nothing here is sold.

## The short version

- Everything you configure (robots, controls, settings, practice runs) is kept **in your own
  browser or app**, on your device. Every key is listed on this page, under **Your data**.
- The app sets **no cookies** of its own.
- There are **no ads**, no payments, and no third-party trackers.
- Online features (accounts, ranked play, shared leaderboards, multiplayer rooms) only exist where
  somebody runs a game server for this build. Without one, you are playing offline.

## What is stored on your own device

Settings, saved robots, saved start positions, key and gamepad bindings, graphics choices,
practice replays and the small flags that remember what you have already seen are written to your
browser's own storage (or, in the desktop app, its app data). None of it is sent anywhere by
itself. **Your data**, linked from the **Data** link in the footer, lists every item with what it
is for, and lets you clear it.

## When a game server is connected

If this build was configured with a game server or sign-in service, then whoever runs that
service decides what it keeps. The software can store: an account identifier and email held by
the sign-in provider, a username, your synced settings, match results and replays, rankings, and
friend links. It does not collect your IP address or full user agent in its own tables. If you
did not sign in, none of that applies.

## Usage measurement

Anonymous page-view counts exist in the code but are **off unless an operator enables them** with
a build setting and a connected server. They carry no account, no IP address and no input.

## Cookies and similar technologies

BFSIM itself sets no cookies. A sign-in provider that an operator connects may set its own,
which that provider's policy covers.

## Your choices

- Clear any stored item from **Your data**, or clear the site's storage in your browser.
- Where accounts exist, **Your data** can export what the server holds about you and delete the
  account.
- Opt out of usage measurement, where it is on, from the same panel.

## Age

BFSIM is made for FTC students and is intended for people aged **13 and over**. It does not
knowingly collect personal information from anyone younger. Any sign-in service an operator
connects has its own age rules.

## Changes

This page changes only when something material does. The date at the top is the last revision.

## Contact

Questions, corrections and deletion requests: open an issue at
[${LEGAL_CONTACT}](${LEGAL_CONTACT}).
`;

export const TERMS_MD = `
## Who you are agreeing with

BFSIM is a noncommercial fork of DSIM, which was created by Dohun Kim. This copy is provided by
**${LEGAL_OPERATOR}**, or by whoever runs the copy you are using. It is an independent project,
not a company product.

## Who can use BFSIM

Anyone aged **13 or over**. If you use it through a school or team, follow their rules too.

## Your account

Where accounts exist, you are responsible for your own. Keep your sign-in private and do not
share it. You can delete an account at any time from the account page.

## Fair play

Do not cheat, exploit bugs to harm other players, harass others, use offensive usernames, or
interfere with a game server. Online results are decided by the server's own simulation, and a
result it cannot reproduce may be removed.

## Free, with no memberships

BFSIM is free. This fork has no paid tier, no donations and no advertising, and every cosmetic
option is available to everyone.

## Your content

You keep what you create (robot designs, names, replays). By using an online feature you let the
service that hosts it store and display that content to run the feature.

## What we do not promise

BFSIM is provided **as is**. It is a practice tool, not an official FIRST product, and the
simulation is an approximation of the real game. Servers may be unavailable, results may be
reset, and features may change.

## Not affiliated with FIRST

BFSIM is an independent, unofficial project. It is **not** affiliated with, endorsed by or
sponsored by FIRST, FIRST Tech Challenge, RTX Corporation, or DSIM or its author. Those names
belong to their owners and are used only to describe the games it practises for.

## Source code and licence

The source is available under the PolyForm Noncommercial License 1.0.0, original work of Dohun
Kim, with this fork's changes by BF Robotics. You may use, study, modify and share it for
noncommercial purposes. See the repository for the licence text and notices.

## Ending things

You can stop using BFSIM at any time and delete your account. An operator may suspend access to
their server for breaking these terms.

## Changes

These terms change only for a material reason. Where accounts exist, you will be asked to accept
a new version before carrying on.

## Contact

Open an issue at [${LEGAL_CONTACT}](${LEGAL_CONTACT}).
`;
