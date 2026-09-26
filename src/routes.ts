// The /api/* router and SPA fallback. Access-key check first, then routes.

import { ACCESS_KEY_HEADER, keyMatches, requiresKey } from "../frontend/src/utils/apiGuard";
import type { AffectedMarket } from "../frontend/src/utils/newsScoring";
import { mergeTradeLogs, type TradeLogEntry } from "../frontend/src/utils/tradeLogCore";
import { computeMarketDepth } from "./depth";
import { fetchEconCalendar, fetchEiaData } from "./eiaCalendar";
import { ALL_SYMBOLS, type Env, getMarketStatus, json, OPTION_SYMBOLS, type Symbol } from "./env";
import { computeExpiryAlerts } from "./expiryAlerts";
import { computeGapStudy, GAP_STUDY_DAYS, getHistorical30mCandles } from "./gapStudy";
import { computeGlobalMarkets, computeOvernightTracker } from "./globalMarkets";
import { type RequestGuard, requireToken } from "./guard";
import { computeKumarAiAnalysis, type KumarAiAnalyzeRequest } from "./kumarAi";
import { fetchEnergyNews } from "./news";
import { NTFY_TOPIC_KV_KEY, runBestCallNotificationCheck, sendNtfyNotification } from "./notify";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { computePullback, serveTimeProfile } from "./profiles";
import { computeCandles, computePrices, computeScan, computeSignal, computeSignals } from "./signals";
import { createPortfolioTrade, deletePortfolioTrade, getPortfolioTrades, getTradeLogsFromKv, type PortfolioTrade, saveTradeLogsToKv, updatePortfolioTrade } from "./storage";
import { getCronStatus } from "./tradeLogCron";
import { getNearestFuture } from "./upstox";
import { computeMacroMarkets, computeWhyToday } from "./whyToday";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // ---- Access guard (see frontend/src/utils/apiGuard.ts) ----
      const expectedKey = env.APP_ACCESS_KEY?.trim() || null;
      const owner = expectedKey ? await keyMatches(request.headers.get(ACCESS_KEY_HEADER), expectedKey) : false;
      if (expectedKey && !owner && requiresKey(request.method, url.pathname)) {
        return json(
          {
            error: "This needs your app access key. Open Settings → App access key and enter the key you set in Cloudflare.",
            needsKey: true,
          },
          401
        );
      }
      const guard: RequestGuard = { ip: request.headers.get("CF-Connecting-IP") ?? "unknown", owner };

      try {
        // Lets the Settings card say whether protection is switched on and
        // whether THIS device's key is accepted. Never echoes the key.
        if (url.pathname === "/api/auth-status") {
          return json({ keyConfigured: Boolean(expectedKey), keyAccepted: owner });
        }

        if (url.pathname === "/api/market-status") {
          return json(getMarketStatus());
        }

        if (url.pathname === "/api/global-markets") {
          return json(await computeGlobalMarkets());
        }

        // "How far has the world moved since MCX shut." Two KV-and-memo reads,
        // no Upstox call, so it is safe to poll from the Price-Alerts page.
        if (url.pathname === "/api/overnight-tracker") {
          return json(await computeOvernightTracker(env));
        }

        // GPT News only. Kept off /api/global-markets so the Global Markets
        // page keeps rendering exactly the three energy benchmarks it always has.
        if (url.pathname === "/api/macro-markets") {
          return json(await computeMacroMarkets(env));
        }

        if (url.pathname === "/api/prices") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          return json(await computePrices(env, token));
        }

        if (url.pathname === "/api/signals") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          return json(await computeSignals(env, token));
        }

        const signalMatch = url.pathname.match(/^\/api\/signals\/([A-Z]+)$/);
        if (signalMatch) {
          const symbol = signalMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          return json(await computeSignal(env, token, symbol));
        }

        if (url.pathname === "/api/scan") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "15";
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await computeScan(env, token, symbol, tf));
        }

        // 90 days of 30-minute candles for the AI Backtest Lab.
        //
        // The Lab runs the backtest IN THE BROWSER, not here: ~1,300 engine
        // evaluations is seconds of CPU and a Worker invocation gets 10 ms.
        // So this endpoint just hands over the candles, which are already the
        // same KV-cached series the gap study and Price-Alerts use -- no extra
        // Upstox call, and the phone has no CPU ceiling.
        if (url.pathname === "/api/history-30m") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          const fut = await getNearestFuture(token, symbol);
          if (!fut) return json({ symbol, tradingSymbol: null, candles: [], error: "No instrument found" });
          const candles = await getHistorical30mCandles(env, token, fut.instrument_key, GAP_STUDY_DAYS);
          return json({ symbol, tradingSymbol: fut.trading_symbol, candles });
        }

        if (url.pathname === "/api/pullback") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await computePullback(env, token, symbol));
        }

        if (url.pathname === "/api/time-profile") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "invalid symbol" }, 400);
          return json(await serveTimeProfile(env, token, symbol));
        }

        if (url.pathname === "/api/gap-study") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeGapStudy(env, token, symbol));
        }

        if (url.pathname === "/api/candles") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          const symbol = url.searchParams.get("symbol") as Symbol;
          const tf = url.searchParams.get("tf") || "1D";
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "invalid symbol" }, 400);
          return json(await computeCandles(env, token, symbol, tf));
        }

        if (url.pathname === "/api/kumar-ai/analyze") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const body = (await request.json().catch(() => null)) as KumarAiAnalyzeRequest | null;
          if (!body || !body.symbol || !body.timeframeLabel || typeof body.entry !== "number") {
            return json({ error: "Invalid request body" }, 400);
          }
          return json(await computeKumarAiAnalysis(env, body));
        }

        const optionsMatch = url.pathname.match(/^\/api\/options\/([A-Z]+)$/);
        if (optionsMatch) {
          const symbol = optionsMatch[1] as Symbol;
          if (!OPTION_SYMBOLS.includes(symbol as any)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          // Strikes the client currently has an open trade tracked against --
          // always kept in the response even if the underlying has since
          // moved far enough that they'd otherwise fall outside the normal
          // ATM-centered window (see nearestStrikes/getOptionChain).
          const pinnedStrikes = (url.searchParams.get("strikes") ?? "")
            .split(",")
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
          return json(await computeOptionsAnalytics(env, token, symbol, pinnedStrikes));
        }

        const depthMatch = url.pathname.match(/^\/api\/depth\/([A-Z]+)$/);
        if (depthMatch) {
          const symbol = depthMatch[1] as Symbol;
          if (!ALL_SYMBOLS.includes(symbol)) return json({ error: "Unsupported symbol" }, 400);
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          return json(await computeMarketDepth(token, symbol));
        }

        if (url.pathname === "/api/news-trade") {
          const [news, eia, calendar] = await Promise.all([fetchEnergyNews(env), fetchEiaData(env), fetchEconCalendar(env)]);
          return json({ news, eia, calendar, marketStatus: getMarketStatus(), fetchedAt: new Date().toISOString() });
        }

        if (url.pathname === "/api/why-today") {
          return json(await computeWhyToday(env));
        }

        // Spec-compliant standalone routes -- same underlying cached
        // fetchers as /api/news-trade above (so there is exactly one place
        // that actually talks to RSS/EIA/FRED), exposed individually for
        // any consumer that only needs one slice rather than the combined
        // decision payload. All server-side, no client ever sees a secret.
        if (url.pathname === "/api/news") {
          const symbolParam = url.searchParams.get("symbol");
          const news = await fetchEnergyNews(env);
          // fetchedAt is the time this response was assembled, which -- because
          // fetchEnergyNews may return a KV hit up to NEWS_CACHE_TTL_SECONDS
          // old -- is an upper bound on freshness, not proof of it. AI Flash
          // labels it as "checked", and every article carries its own real
          // publishedAt for the age shown on the item itself.
          const fetchedAt = new Date().toISOString();
          if (!symbolParam) return json({ ...news, fetchedAt });
          const marketKey: AffectedMarket = symbolParam.toUpperCase() === "NG" ? "NG" : symbolParam.toUpperCase() === "CRUDE" ? "CRUDE" : "BOTH";
          return json({
            ...news,
            fetchedAt,
            articles: news.articles.filter((a) => a.affectedMarket === marketKey || a.affectedMarket === "BOTH"),
            events: news.events.filter((e) => e.affectedMarket === marketKey || e.affectedMarket === "BOTH"),
          });
        }

        if (url.pathname === "/api/events") {
          const news = await fetchEnergyNews(env);
          return json({ available: news.available, events: news.events, error: news.error });
        }

        if (url.pathname === "/api/energy") {
          const eia = await fetchEiaData(env);
          return json(eia);
        }

        if (url.pathname === "/api/notify/topic") {
          if (request.method === "GET") {
            const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
            return json({ topic: topic ?? null });
          }
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as { topic?: string };
            const topic = (body.topic ?? "").trim();
            if (!topic || topic.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(topic)) {
              return json({ error: "Topic must be 1-64 characters: letters, numbers, dashes, or underscores only" }, 400);
            }
            await env.COMMODITY_KV.put(NTFY_TOPIC_KV_KEY, topic);
            return json({ ok: true, topic });
          }
          if (request.method === "DELETE") {
            await env.COMMODITY_KV.delete(NTFY_TOPIC_KV_KEY);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/notify/test") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
          if (!topic) return json({ error: "No ntfy topic saved yet -- save one first" }, 400);
          const result = await sendNtfyNotification(topic, "Kumar Signals Pro test", "If you can see this, background push notifications are working.");
          if (!result.ok) return json({ error: result.error ?? "Failed to send test notification" }, 502);
          return json({ ok: true });
        }

        if (url.pathname === "/api/notify/check-now") {
          if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
          await runBestCallNotificationCheck(env);
          return json({ ok: true });
        }

        if (url.pathname === "/api/expiry-alerts") {
          const token = await requireToken(env, guard);
          if (token instanceof Response) return token;
          return json({ alerts: await computeExpiryAlerts(token) });
        }

        if (url.pathname === "/api/portfolio") {
          if (request.method === "GET") return json(await getPortfolioTrades(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await createPortfolioTrade(env, body), 201);
          }
          return json({ error: "Method not allowed" }, 405);
        }

        const portfolioMatch = url.pathname.match(/^\/api\/portfolio\/([a-zA-Z0-9-]+)$/);
        if (portfolioMatch) {
          const id = portfolioMatch[1];
          if (request.method === "PATCH") {
            const body = (await request.json().catch(() => ({}))) as Partial<PortfolioTrade>;
            return json(await updatePortfolioTrade(env, id, body));
          }
          if (request.method === "DELETE") {
            await deletePortfolioTrade(env, id);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        if (url.pathname === "/api/cron-status") {
          return json(await getCronStatus(env));
        }

        if (url.pathname === "/api/trade-logs") {
          if (request.method === "GET") return json(await getTradeLogsFromKv(env));
          if (request.method === "POST") {
            const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
            if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Body must be an object keyed by trade-log id" }, 400);
            // Merge the incoming client push OVER what's already in KV rather
            // than overwriting -- the Cron may have closed a trade server-side
            // that the client still shows as open, and the merge's "closed
            // version always wins" rule keeps that close instead of letting a
            // stale-open client copy resurrect it. (incoming = "local",
            // existing KV = "server".)
            const existing = (await getTradeLogsFromKv(env)) as Record<string, TradeLogEntry[]>;
            const merged = mergeTradeLogs(body as Record<string, TradeLogEntry[]>, existing);
            await saveTradeLogsToKv(env, merged);
            return json({ ok: true });
          }
          return json({ error: "Method not allowed" }, 405);
        }

        return json({ error: "Not found" }, 404);
      } catch (err: any) {
        // Full detail (including anything a stack trace would show) goes to
        // Cloudflare's own logs (wrangler tail / dashboard) only -- the
        // client only ever sees a short, capped message, never a trace.
        console.error("API error:", err);
        const message = typeof err?.message === "string" && err.message.length > 0 ? err.message.slice(0, 300) : "Internal server error";
        return json({ error: message }, 500);
      }
    }

    // Static SPA assets. Anything not matching a built file (client-side
    // routes like /charts, /options) falls back to index.html.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status === 404) {
      const indexRequest = new Request(new URL("/index.html", url), request);
      return env.ASSETS.fetch(indexRequest);
    }
    return assetResponse;
}
