// Which pages are allowed to poll on their own.
//
// Every page in this app polls its data on a timer. That is right for the
// handful of pages a trader actually watches during a session, and wasteful
// for the twenty-odd others -- each one that auto-refreshes burns Upstox rate
// limit, Cloudflare Worker invocations and phone battery for a screen nobody
// is reading closely.
//
// So: the six pages in the bottom bar stay live always. Everything else
// fetches ONCE when you open it and then holds still until you tap Update
// (or switch auto-update on for the session).
//
// This list is the single source of truth. BottomNav builds its primary tabs
// from it and the query hooks read it to decide whether to set a refetch
// interval at all, so the two can never disagree about what "the main pages"
// means.

export const LIVE_PAGE_PATHS = [
  "/", // AI-Shoot
  "/best-call",
  "/ai-20-20",
  "/level-cross-scan",
  "/ai-up",
  "/ai-supertrend-pro",
] as const;

export type LivePagePath = (typeof LIVE_PAGE_PATHS)[number];

const ALWAYS_LIVE = new Set<string>(LIVE_PAGE_PATHS);

/** True when this route is one of the six that always keep updating. */
export function isAlwaysLivePage(pathname: string): boolean {
  // Trailing slashes arrive from some deep links; "/best-call/" is the same page.
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return ALWAYS_LIVE.has(clean);
}

/**
 * The refetch interval a query should actually use.
 *
 * `false` is React Query's own value for "do not poll", so a paused page still
 * loads its data once on open and simply never asks again -- it does not show
 * an empty screen.
 */
export function refetchIntervalFor(pathname: string, liveOverride: boolean, ms: number): number | false {
  return isAlwaysLivePage(pathname) || liveOverride ? ms : false;
}
