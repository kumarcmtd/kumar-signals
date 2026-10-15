// The Cron Trigger's work, split across THREE triggers (wrangler.jsonc
// "triggers.crons"), because on the Workers free plan every invocation gets
// 10 ms of CPU and everything started inside one invocation shares it.
//
// Before the split, one tick ran seven jobs together. Measured on the real code
// with realistic data (scripts/bench-cron.ts), a market-hours tick cost ~520 ms
// of CPU -- fifty times the budget -- so Cloudflare killed it mid-run, taking
// the trade tracking and news refresh down with the heavy jobs. Separate
// triggers are separate invocations, each with its own 10 ms:
//
//   */5        FAST     Ai20-20 + Best Call pushes, expiry alerts, overnight anchor
//   1-59/5     TRADES   trade-log advance and the end-of-day close; when no
//                       trade is open, one missing time profile instead
//   2-59/5     WARM     every news feed (paid plan: each source <= ~5 min old)
//
// Each job still decides for itself whether it has anything to do: most exit
// immediately outside MCX hours, and none makes an Upstox call while the
// market is shut unless something genuinely needs it.
//
// The Best Call push (runBestCallNotificationCheck) runs in FAST again since
// the move to the Workers paid plan (29 Sep 2026), at the owner's request.
// It computes three engines on four timeframes for both symbols -- 25-45 ms
// of CPU, which the free plan's 10 ms could not hold.

import type { Env } from "./env";
import { runExpiryAlertCheck } from "./expiryAlerts";
import { captureOvernightAnchor } from "./globalMarkets";
import { warmEnergyNews } from "./news";
import { runNewsFlashCheck } from "./newsFlash";
import { runBestCallNotificationCheck, runTwentyTwentyNotificationCheck } from "./notify";
import { warmTimeProfiles } from "./profiles";
import { runTradeLogAdvanceCheck } from "./tradeLogCron";
import { runTradeCardTracker } from "./tradeCardTracker";
import { runImportantAlerts } from "./importantAlerts";
import { bindSharedCache } from "./upstox";

export const CRON_FAST = "*/5 * * * *";
export const CRON_TRADES = "1-59/5 * * * *";
export const CRON_WARM = "2-59/5 * * * *";

export async function runScheduled(env: Env, ctx: ExecutionContext, cron: string): Promise<void> {
  bindSharedCache(env);

  if (cron === CRON_TRADES) {
    // A run with no open trade costs well under 1 ms, so it has room to
    // build at most one missing Price-Alerts profile (~10 ms is too much to
    // share with a run that is advancing trades). Never both in one run.
    ctx.waitUntil(
      (async () => {
        const busy = await runTradeLogAdvanceCheck(env);
        if (!busy) await warmTimeProfiles(env);
      })()
    );
    return;
  }

  if (cron === CRON_WARM) {
    // Keeps the news feeds warm so no browser request ever has to rebuild
    // ~35 RSS sources inside a 10 ms CPU budget.
    // Then push any brand-new major headline (war, supply halt, ceasefire)
    // from the freshly built feed.
    ctx.waitUntil(warmEnergyNews(env).then(() => runNewsFlashCheck(env)).catch(() => undefined));
    return;
  }

  // FAST, and the fallback for any unrecognised schedule.
  // Ai20-20 -- the page actually traded, pushed with the app closed.
  ctx.waitUntil(runBestCallNotificationCheck(env));
  ctx.waitUntil(runExpiryAlertCheck(env));
  // The Trade Card's own scorecard: log its TRADE calls, settle them on target / stop / day end,
  // and push each. Then Ai20-20's MATCHED check, which skips a trade the card already pushed.
  ctx.waitUntil(
    runTradeCardTracker(env)
      .catch(() => undefined)
      .then(() => runTwentyTwentyNotificationCheck(env))
  );
  // EIA release in ~30 min; live data failing at the open.
  ctx.waitUntil(runImportantAlerts(env).catch(() => undefined));
  // One snapshot per trading day, just after MCX shuts, so tomorrow morning
  // "moved since MCX closed" is a measured figure rather than an estimate.
  ctx.waitUntil(captureOvernightAnchor(env));
}
