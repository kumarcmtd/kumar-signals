// Records the Trade Card's TRADE calls and settles them, every 5 minutes,
// with no browser open -- the same pure engine the card renders
// (frontend/src/utils/tradeVerdict), so the scorecard is the card's own.
// One KV key holds both markets' logs; it is written only when something
// changed (a new call, or a call closing), not on every run.

import { cachePut, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { getCandlesForTF } from "./signals";
import { getNearestFuture } from "./upstox";
import { fetchEnergyNews } from "./news";
import { fetchEiaData } from "./eiaCalendar";
import { evaluateBuyDecision } from "../frontend/src/utils/buyDecisionEngine";
import { tradeVerdict } from "../frontend/src/utils/tradeVerdict";
import { newsPulseFor } from "../frontend/src/utils/newsPulse";
import { advanceCall, maybeOpen, type CardCall } from "../frontend/src/utils/tradeCardLog";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { scheduledEvents } from "../frontend/src/utils/timeProfileEngine";
import { sessionBucketStart } from "../frontend/src/utils/candleResample";

export const TRADE_CARD_LOG_KEY = "tradecard:log:v1";
export type CardLogs = Partial<Record<"CRUDEOIL" | "NATURALGAS", CardCall[]>>;

export async function readCardLogs(env: Env): Promise<CardLogs> {
  try {
    return JSON.parse((await env.COMMODITY_KV.get(TRADE_CARD_LOG_KEY)) ?? "{}") as CardLogs;
  } catch {
    return {};
  }
}

export async function runTradeCardTracker(env: Env): Promise<string[]> {
  const report: string[] = [];
  const logs = await readCardLogs(env);
  const anyOpen = Object.values(logs).some((l) => l?.some((c) => !c.closed));
  const open = getMarketStatus().isOpen;
  // Closed market and nothing to settle: no Upstox call at all.
  if (!open && !anyOpen) return ["MCX closed and no open Trade Card call."];
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return ["Not logged in to Upstox -- cannot follow the Trade Card calls."];

  const now = Date.now();
  const session = mcxSessionAt(now);
  // Close at the last 5-minute candle of the day (or once MCX is shut).
  const dayOver = !session.isOpen || session.closeMin - session.minutes <= 5;
  let changed = false;
  let newsCache: Awaited<ReturnType<typeof fetchEnergyNews>> | null | undefined;
  let eiaCache: Awaited<ReturnType<typeof fetchEiaData>> | null | undefined;

  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL";
    const say = (t: string) => report.push(`${sym}: ${t}`);
    let log = logs[sym] ?? [];
    try {
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) {
        say("no futures contract.");
        continue;
      }
      const c5 = await getCandlesForTF(env, token, fut, "5");
      if ("error" in c5) {
        say("no 5-minute candles.");
        continue;
      }
      const closed5 = c5.filter((c) => Date.parse(c.date) < sessionBucketStart(now, 5));

      // 1. Settle the open call, if any.
      const before = JSON.stringify(log);
      log = log.map((c) => advanceCall(c, closed5, dayOver));
      if (JSON.stringify(log) !== before) changed = true;

      // 2. A new call, only while the market is open and not in the last minutes.
      if (!dayOver && !log.some((c) => !c.closed)) {
        const [c15, c60, c240] = await Promise.all(["15", "60", "240"].map((tf) => getCandlesForTF(env, token, fut, tf)));
        if ("error" in c15 || "error" in c60 || "error" in c240) {
          say("15m/1h/4h candles did not load.");
        } else {
          const event = scheduledEvents(now).find((e) => e.affects === symbol);
          const result = evaluateBuyDecision({
            c15,
            c60,
            c240,
            now,
            marketOpen: true,
            eia: event ? { minutesAway: event.minutesAway, minutesSince: 7 * 24 * 60 - event.minutesAway, label: event.name } : null,
            minutesToClose: session.closeMin - session.minutes,
            daysToOptionExpiry: null,
          });
          if (newsCache === undefined) newsCache = await fetchEnergyNews(env).catch(() => null);
          if (eiaCache === undefined) eiaCache = await fetchEiaData(env).catch(() => null);
          const eia = sym === "CRUDEOIL" ? (eiaCache?.crude ?? null) : (eiaCache?.ngStorage ?? null);
          const news = newsCache?.available ? newsPulseFor(sym, newsCache.articles, eia, newsCache.builtAt ?? null, now) : null;
          const v = tradeVerdict({ result, c5, c15, news, now, marketOpen: true });
          const next = maybeOpen(log, sym, v, closed5[closed5.length - 1] ?? null);
          if (next !== log) {
            changed = true;
            say(`new ${v.side} call logged.`);
          } else say(`card says ${v.headline}.`);
          log = next;
        }
      }
      logs[sym] = log;
    } catch (e: any) {
      say(`failed (${e?.message ?? "error"}).`);
    }
  }

  if (changed) {
    const ok = await cachePut(env.COMMODITY_KV, TRADE_CARD_LOG_KEY, JSON.stringify(logs));
    report.push(ok ? "log saved." : "log could not be saved.");
  }
  return report;
}
