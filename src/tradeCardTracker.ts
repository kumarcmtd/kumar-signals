// Records the Trade Card's TRADE calls and settles them, every 5 minutes,
// with no browser open -- the same pure engine the card renders
// (frontend/src/utils/tradeVerdict), so the scorecard is the card's own.
// One KV key holds both markets' logs; it is written only when something
// changed (a new call, or a call closing), not on every run.

import { cachePut, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { getCandlesForTF } from "./signals";
import { getNearestFuture } from "./upstox";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";
import { fetchEnergyNews } from "./news";
import { fetchEiaData } from "./eiaCalendar";
import { evaluateBuyDecision } from "../frontend/src/utils/buyDecisionEngine";
import { tradeVerdict } from "../frontend/src/utils/tradeVerdict";
import { newsPulseFor } from "../frontend/src/utils/newsPulse";
import { advanceCall, maybeOpen, type CardCall } from "../frontend/src/utils/tradeCardLog";
import { trustGrade } from "../frontend/src/utils/trustGrade";
import { marketChecklist } from "../frontend/src/utils/checklist";
import { gradeTiers, quickTier, trustTier } from "../frontend/src/utils/tradeTiers";
import { daysToExpiry } from "../frontend/src/utils/oiBuildup";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { scheduledEvents } from "../frontend/src/utils/timeProfileEngine";
import { sessionBucketStart } from "../frontend/src/utils/candleResample";

export const TRADE_CARD_LOG_KEY = "tradecard:log:v1";
export type CardLogs = Partial<Record<"CRUDEOIL" | "NATURALGAS", CardCall[]>>;

const NAME = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" } as const;
const istTime = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(11, 16);

export interface OptionHint {
  daysToExpiry?: number | null;
  strike: number;
  ltp: number;
  atStop: number | null;
  atT1: number | null;
}

/** Push text when the card turns full green / full red. */
export function cardTradeText(c: CardCall, opt: OptionHint | null): { title: string; body: string } {
  const name = NAME[c.symbol];
  const risk = Math.abs(c.entry - c.stop);
  const rr = risk > 0 ? Math.round((Math.abs(c.t1 - c.entry) / risk) * 10) / 10 : null;
  return {
    title:
      c.tier === "quick"
        ? `⚡ QUICK ${c.side}: ${name}${opt ? ` ${opt.strike} ${c.side}` : ""} (half size)`
        : `${c.trust ? "💎 AI-TRUST · " : ""}${c.side === "CE" ? "🟢" : "🔴"} TRADE ${c.side}: ${name}${opt ? ` ${opt.strike} ${c.side}` : ""}`,
    body: [
      c.tier === "quick"
        ? `QUICK TRADE -- strong one-sided 5-min push (${istTime(c.openedAt)}). HALF size.${c.exitByIso ? ` Exit by ${istTime(c.exitByIso)} if no target.` : ""}`
        : c.tier === "trust"
          ? `AI-TRUST call -- all core checks pass (${istTime(c.openedAt)} candle). Full size.`
          : `Trade Card is FULL ${c.side === "CE" ? "GREEN" : "RED"} -- all checks pass (${istTime(c.openedAt)} candle).`,
      c.reason,
      "",
      opt ? `Option: ${name} ${opt.strike} ${c.side} @ ~Rs ${opt.ltp}` : `Option: ATM ${c.side}`,
      `Futures entry ${c.entry} | stop ${c.stop} | target ${c.t1}${c.t2 ? ` / ${c.t2}` : ""}${rr ? ` (${rr}x reward)` : ""}`,
      opt && opt.atStop !== null && opt.atT1 !== null ? `Premium estimate: stop ~Rs ${opt.atStop} | target ~Rs ${opt.atT1}` : "",
      "",
      "Exit if a 5-min candle closes beyond the stop. Check the card before entering -- price may have moved.",
    ]
      .filter((l): l is string => l !== null)
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n"),
  };
}

/** Push text when a Trade Card call ends. */
export function cardCloseText(c: CardCall): { title: string; body: string } {
  const name = NAME[c.symbol];
  const pts = c.pnlPts ?? 0;
  const r = c.r ?? 0;
  const head =
    c.result === "target"
      ? `✅ TARGET hit: ${name} ${c.side}`
      : c.result === "stop"
        ? `🛑 STOP hit: ${name} ${c.side} -- exit`
        : c.result === "time_exit"
          ? `⏱ Time up: ${name} ${c.side} quick trade -- close it`
          : `🔔 Day end: ${name} ${c.side} -- close it`;
  const what =
    c.result === "target"
      ? "Book profit now, or at least move your stop to cost."
      : c.result === "stop"
        ? "The setup failed. Exit now -- don't average, don't hope."
        : c.result === "time_exit"
          ? "30 minutes and no target: the quick move has stalled. Close it -- quick trades are not held."
          : "MCX is closing and neither target nor stop was hit. Close the trade; don't carry an option overnight.";
  return {
    title: head,
    body: [`Futures ${c.entry} -> ${c.exit} (${pts >= 0 ? "+" : ""}${pts} pts, ${r >= 0 ? "+" : ""}${r}R).`, what, "", "Results: More -> Trade Report -> Trade Card."].join("\n"),
  };
}

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
  const pushes: { title: string; body: string; priority: "urgent" | "high" }[] = [];
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
      log = log.map((c) => {
        const next = advanceCall(c, closed5, dayOver);
        if (!c.closed && next.closed) pushes.push({ ...cardCloseText(next), priority: next.result === "stop" ? "urgent" : "high" });
        return next;
      });
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
          // The same tiers as the Ai-Trust page (utils/tradeTiers):
          // 💎 trust (core + 70% supporting) > Trade Card TRADE > ⚡ quick.
          const mtc = session.closeMin - session.minutes;
          const mc = marketChecklist({ symbol: sym, v, c15, c60, now });
          const g = trustGrade(v, { minutesToClose: mtc, optionDaysToExpiry: null });
          const tiers = gradeTiers(trustTier(v, mc, g, mtc), quickTier({ symbol: sym, c5, c15, v, mc, news, now, minutesToClose: mtc }));
          const lastClosed = closed5[closed5.length - 1] ?? null;
          const qp = tiers.quick.plan;
          let next = log;
          if (tiers.tier === "trust" && mc.plan) {
            const p = mc.plan;
            next = maybeOpen(log, sym, { action: `TRADE_${p.side}`, side: p.side, stop: p.stop, t1: p.t1, reason: `All core checks pass, supporting ${tiers.trust.supportPct}%.` }, lastClosed, { tier: "trust", trust: true, t2: p.t2 });
          } else if (v.action === "TRADE_CE" || v.action === "TRADE_PE") {
            next = maybeOpen(log, sym, v, lastClosed, { tier: "card", trust: false });
          } else if (tiers.tier === "quick" && qp) {
            next = maybeOpen(
              log,
              sym,
              { action: `TRADE_${qp.side}`, side: qp.side, stop: qp.stop, t1: qp.t1, reason: `Strong 5-min push${tiers.quick.counterTrend ? ", news-led against the 1-hour trend" : ""}.` },
              lastClosed,
              { tier: "quick", trust: false, t2: qp.t2, exitByIso: qp.exitByIso },
            );
          }
          if (next !== log) {
            changed = true;
            const opened = next[next.length - 1];
            const opt = await optionHint(env, token, symbol as Symbol, opened);
            say(`new ${opened.tier} ${opened.side} call logged.`);
            pushes.push({ ...cardTradeText(opened, opt), priority: "urgent" });
          } else say(`card says ${v.headline}; tier ${tiers.tier}.`);
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
    // Push only once the log is saved -- otherwise the same call would be
    // "new" again next run and push every 5 minutes.
    const topic = ok && pushes.length ? await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY) : null;
    for (const p of topic ? pushes : []) {
      const r = await sendNtfyNotification(topic!, p.title, p.body, p.priority, { token: env.NTFY_TOKEN });
      report.push(`push "${p.title}": ${r.ok ? "sent" : "failed"}.`);
    }
  }
  return report;
}

/** The ATM option for a new call, and its premium at the stop and target (delta estimate). */
async function optionHint(env: Env, token: string, symbol: Symbol, c: CardCall): Promise<OptionHint | null> {
  try {
    const o = await computeOptionsAnalytics(env, token, symbol);
    if ("error" in o || o.atmStrike === null) return null;
    const row = o.rows.find((r) => r.strike === o.atmStrike);
    const leg = row ? (c.side === "CE" ? row.call : row.put) : null;
    if (!row || !leg || typeof leg.ltp !== "number") return null;
    const d = typeof leg.delta === "number" && Number.isFinite(leg.delta) ? leg.delta : null;
    const at = (level: number) => (d === null ? null : Math.max(0.05, Math.round((leg.ltp! + d * (level - o.spot)) * 10) / 10));
    return { strike: row.strike, ltp: leg.ltp, atStop: at(c.stop), atT1: at(c.t1), daysToExpiry: daysToExpiry(o.expiry) };
  } catch {
    return null;
  }
}
