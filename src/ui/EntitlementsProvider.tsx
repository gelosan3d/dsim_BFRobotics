import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { authClient, authEnabled } from '../lib/authClient';
import { ENTITLEMENTS_CHANGED, fetchEntitlements } from '../net/api';

/**
 * What this account has unlocked, for the whole app.
 *
 * Self-contained on purpose: it reads the auth session and fetches the entitlement itself, so it
 * can wrap the whole app ONCE in `main.tsx`. The game screen renders outside the app shell
 * (`App.tsx` returns it early), so a provider threaded through the shell would miss it.
 *
 * BFSIM HAS NO ADS AND NO PAID TIER. This used to be `AdsProvider` and also decided whether ad
 * slots rendered; that half is gone. What is left is the account's EARNED cosmetic unlocks, which
 * the builder's swatches read. `supporter` is still reported by the server and still carried
 * here, but nothing gates on it any more (`cosmeticAllowed` and `savedStartCap` ignore it).
 */
interface EntitlementState {
  /** the server's supporter flag; informational only, no perk reads it */
  supporter: boolean;
  /** has the entitlement check finished? false ⇒ not known yet */
  checked: boolean;
  /**
   * This account's EARNED, permanent cosmetic unlocks (`profiles.cosmetics`), as
   * `"<axis>:<key>"` ids.
   *
   * ⚠️ UX ONLY. The server strips an unentitled spec on join and on every re-pick
   * (`stripUnentitledCosmetics`, `server/room.ts`) whatever this said, so a wrong answer
   * here shows the wrong swatch state and buys nothing.
   */
  earnedCosmetics: readonly string[];
}

const Ctx = createContext<EntitlementState>({ supporter: false, checked: false, earnedCosmetics: [] });

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const session = authClient?.useSession();
  const userId = session?.data?.user?.id ?? null;

  const [supporter, setSupporter] = useState(false);
  const [checked, setChecked] = useState(false);
  const [earnedCosmetics, setEarnedCosmetics] = useState<readonly string[]>([]);
  /* bumped by `ENTITLEMENTS_CHANGED` — a claimed reward that unlocked a cosmetic — so the
     builder's swatch unlocks without a reload. Re-running the effect below IS the re-read. */
  const [epoch, setEpoch] = useState(0);
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    const bump = (): void => setEpoch((n) => n + 1);
    window.addEventListener(ENTITLEMENTS_CHANGED, bump);
    return () => window.removeEventListener(ENTITLEMENTS_CHANGED, bump);
  }, []);

  useEffect(() => {
    // Nothing to ask about: auth is off in this build, or nobody is signed in.
    if (!authEnabled || !userId) {
      setSupporter(false);
      setEarnedCosmetics([]);
      setChecked(true);
      checkedFor.current = null;
      return;
    }
    let cancelled = false;
    // a RE-READ for the same account (`epoch`) keeps the settled answer on screen while it runs
    if (checkedFor.current !== userId) setChecked(false);
    checkedFor.current = userId;
    void fetchEntitlements().then((e) => {
      if (cancelled) return;
      setSupporter(e.supporter);
      /* `?? []`: `undefined` means "this server did not say" (an older build, or the swallowed
         failure path) rather than "nothing earned"; both land on the same empty list here. */
      setEarnedCosmetics(e.unlockedCosmetics ?? []);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, epoch]);

  return <Ctx.Provider value={{ supporter, checked, earnedCosmetics }}>{children}</Ctx.Provider>;
}

/** the account's unlocks. Client state is UX only — the server is authority. */
export function useEntitlements(): EntitlementState {
  return useContext(Ctx);
}
