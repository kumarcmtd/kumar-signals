// The Cron Trigger's work, one tick every five minutes (wrangler.jsonc
// "triggers.crons"). Each job decides for itself whether it has anything to do
// right now: most exit immediately outside MCX hours, and none of them makes an
// Upstox call while the market is shut unless something genuinely needs it
// (see each job's own comment).

import type { Env } from "./env";
import { runExpiryAlertCheck } from "./expiryAlerts";
import { captureOvernightAnchor } from "./globalMarkets";
import { warmEnergyNews } from "./news";
import { runBestCallNotificationCheck, runTwentyTwentyNotificationCheck } from "./notify";
import { warmTimeProfiles } from "./profiles";
import { runTradeLogAdvanceCheck } from "./tradeLogCron";
import { bindSharedCache } from "./upstox";

export async function runScheduled(env: Env, ctx: ExecutionContext): Promise<void> {
  bindSharedCache(env);
  ctx.waitUntil(runBestCallNotificationCheck(env));
  // Ai20-20 -- the page actually traded, pushed with the app closed.
  ctx.waitUntil(runTwentyTwentyNotificationCheck(env));
  ctx.waitUntil(runExpiryAlertCheck(env));
  ctx.waitUntil(runTradeLogAdvanceCheck(env));
  // Builds the Price-Alerts profile off the request path. Does nothing on a
  // tick where today's profile is already cached.
  ctx.waitUntil(warmTimeProfiles(env));
  // Keeps the news feeds warm so no browser request ever has to rebuild
  // ~35 RSS sources inside a 10ms CPU budget. See NEWS_CACHE_TTL_SECONDS.
  ctx.waitUntil(warmEnergyNews(env));
  // One snapshot per trading day, just after MCX shuts, so tomorrow morning
  // "moved since MCX closed" is a measured figure rather than an estimate.
  ctx.waitUntil(captureOvernightAnchor(env));
}
