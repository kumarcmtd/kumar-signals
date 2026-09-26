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
//   */5        FAST     Ai20-20 push, expiry alerts, overnight anchor
//   1-59/5     TRADES   trade-log advance and the end-of-day close
//   2-59/10    WARM     news, else one missing time profile -- never both
//
// Each job still decides for itself whether it has anything to do: most exit
// immediately outside MCX hours, and none makes an Upstox call while the
// market is shut unless something genuinely needs it.
//
// NOT SCHEDULED: the Best Call push (runBestCallNotificationCheck). It
// computes three engines on four timeframes for both symbols -- 25-45 ms of
// pure indicator maths after every optimisation, so it cannot fit the free
// plan by itself -- and it pushed Best Call alerts to the same ntfy topic even
// after alerts were narrowed to Ai20-20 only. The Best Call page itself runs
// in the browser and is unaffected. To bring the push back (e.g. on the paid
// plan), add it to the FAST group.

import type { Env } from "./env";
import { runExpiryAlertCheck } from "./expiryAlerts";
import { captureOvernightAnchor } from "./globalMarkets";
import { warmEnergyNews } from "./news";
import { runTwentyTwentyNotificationCheck } from "./notify";
import { warmTimeProfiles } from "./profiles";
import { runTradeLogAdvanceCheck } from "./tradeLogCron";
import { bindSharedCache } from "./upstox";

export const CRON_FAST = "*/5 * * * *";
export const CRON_TRADES = "1-59/5 * * * *";
export const CRON_WARM = "2-59/10 * * * *";

export async function runScheduled(env: Env, ctx: ExecutionContext, cron: string): Promise<void> {
  bindSharedCache(env);

  if (cron === CRON_TRADES) {
    ctx.waitUntil(runTradeLogAdvanceCheck(env));
    return;
  }

  if (cron === CRON_WARM) {
    // Keeps the news feeds warm so no browser request ever has to rebuild
    // ~35 RSS sources inside a 10 ms CPU budget; when news is fresh, builds
    // at most one missing Price-Alerts profile instead. Never both in one run.
    ctx.waitUntil(
      (async () => {
        const rebuiltNews = await warmEnergyNews(env);
        if (!rebuiltNews) await warmTimeProfiles(env);
      })()
    );
    return;
  }

  // FAST, and the fallback for any unrecognised schedule.
  // Ai20-20 -- the page actually traded, pushed with the app closed.
  ctx.waitUntil(runTwentyTwentyNotificationCheck(env));
  ctx.waitUntil(runExpiryAlertCheck(env));
  // One snapshot per trading day, just after MCX shuts, so tomorrow morning
  // "moved since MCX closed" is a measured figure rather than an estimate.
  ctx.waitUntil(captureOvernightAnchor(env));
}
