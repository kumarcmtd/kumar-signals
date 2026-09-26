// Kumar Signals Pro API worker -- entry point only.
// Serves JSON under /api/* and falls back to the built React SPA (frontend/dist)
// for everything else via the ASSETS binding.
//
// The code lives in src/, one concern per module and each kept under ~400
// lines. The scoring engines are the exact same pure, React-free modules the
// frontend imports from frontend/src/utils -- reused, never reimplemented -- so
// the cron's background checks can never drift from what the app displays.
//
//   src/env.ts               bindings, security headers, core types, Upstox JSON
//   src/upstox.ts            futures list (cached) and candle history
//   src/optionChain.ts       option chain assembly and fallbacks
//   src/greeks.ts            Black-76 Greeks, IV, max pain
//   src/signals.ts           signal cards, scans, candles, price cards
//   src/gapStudy.ts          morning gap study
//   src/globalMarkets.ts     WTI/Brent/Henry Hub and the overnight anchor
//   src/profiles.ts          pullback read and time-of-day profile
//   src/whyToday.ts          macro backdrop and "Why Today"
//   src/news.ts              RSS + NewsAPI energy news
//   src/eiaCalendar.ts       EIA data and economic calendar
//   src/depth.ts             order-book depth
//   src/optionsAnalytics.ts  options page analytics
//   src/storage.ts           portfolio and trade logs in KV
//   src/tradeLogCron.ts      trade advancement and the EOD close
//   src/kumarAi.ts           Workers AI reasoning layer
//   src/notify.ts            ntfy Best Call / Ai20-20 pushes
//   src/expiryAlerts.ts      options expiry alerts
//   src/guard.ts             requireToken + Upstox route rate limit
//   src/routes.ts            the /api/* router
//   src/cron.ts              the scheduled tick

import { runScheduled } from "./src/cron";
import { withSecurityHeaders, type Env } from "./src/env";
import { handleRequest } from "./src/routes";
import { bindSharedCache } from "./src/upstox";

export type { Env };

export default {
  // Every response this Worker can return -- API JSON, index.html, and every
  // static asset -- passes through withSecurityHeaders exactly once here,
  // so no individual route can accidentally ship without the app's security
  // headers by forgetting to set them itself.
  async fetch(request: Request, env: Env): Promise<Response> {
    bindSharedCache(env);
    return withSecurityHeaders(await handleRequest(request, env));
  },

  // Cloudflare Cron Trigger (see wrangler.jsonc "triggers.crons") -- runs
  // independent of any browser tab being open, which is what makes push
  // notifications actually reach the user with the app fully closed.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await runScheduled(env, ctx);
  },
};
