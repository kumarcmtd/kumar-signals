// Two ways to a trade, so the page is strict where it matters and quick
// where the market is quick:
//
// 💎 TRUST  -- the swing-style call. CORE items must all pass (trend on
//             15m/1h, the Trade Card's confirmed trend, news not against,
//             no report due, room to the next level, 1:2 on a sensible stop,
//             not the last 45 min). SUPPORTING items (RSI, MACD, divergence,
//             volume, OI, zone, 5-min steadiness, trend strength, news actively
//             with it, expiry day) need about 3 in 4, not all -- one weak
//             indicator no longer blocks a strong setup.
// ⚡ QUICK  -- a short 5-to-15-minute trade on a strong one-sided push, like
//             Ai20-20, but checked: 2 of the last 3 five-minute candles strong
//             the same way with volume, the 15-min agreeing, news not against
//             (and actively WITH it if the trade goes against the 1-hour
//             trend), not already over-stretched, a tight stop with 1.5x room
//             to the next level, no report due. HALF size, a 30-minute time
//             stop, and targets at 1.5R / 2.5R.
// Neither tier can make a loss impossible. Quick trades lose more often --
// that is why they are half size with a tight stop.

import type { Candle } from "../types";
import type { TradeVerdict } from "./tradeVerdict";
import { readCandle } from "./tradeVerdict";
import type { MarketChecklist, CheckItem } from "./checklist";
import type { TrustGrade } from "./trustGrade";
import { newsVsSide, type NewsPulse } from "./newsPulse";
import { atr, emaLast } from "./indicators";
import { sessionBucketStart } from "./candleResample";
import { scheduledEvents } from "./timeProfileEngine";

export const SUPPORT_NEEDED = 0.7;
const QUICK_HOLD_MIN = 30;

export interface TrustTier {
  ok: boolean;
  core: CheckItem[];
  support: CheckItem[];
  supportPct: number | null; // 0..100
  failed: string[];
}

export interface QuickPlan {
  side: "CE" | "PE";
  entry: number;
  stop: number;
  t1: number;
  t2: number;
  rr: number; // room to the next level / risk
  exitBy: string; // IST HH:MM time stop
  exitByIso: string;
}

export interface QuickTier {
  ok: boolean;
  side: "CE" | "PE" | null;
  counterTrend: boolean;
  items: CheckItem[];
  plan: QuickPlan | null;
  failed: string[];
}

export interface Tiers {
  tier: "trust" | "quick" | "none";
  trust: TrustTier;
  quick: QuickTier;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rs = (n: number) => `₹${n.toFixed(2)}`;
const hhmm = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(11, 16);
const CORE_IDS = new Set(["h1", "m15", "eia", "room", "rr"]);
const SKIP_IDS = new Set(["tf", "atr", "piv", "pd", "mr", "wx", "api", "news"]); // duplicates or info

export function trustTier(v: TradeVerdict, mc: MarketChecklist, g: TrustGrade, minutesToClose: number | null): TrustTier {
  const all = mc.sections.flatMap((s) => s.items);
  const trendCheck = v.checks.find((c) => c.key === "trend");
  const lateDay = minutesToClose !== null && minutesToClose < 45;
  const newsOk = v.newsSide !== "against" && v.newsSide !== "strongly_against";
  const core: CheckItem[] = [
    { id: "side", label: "Trend confirmed on closed candles", state: v.side && trendCheck?.state === "pass" ? "pass" : "fail", text: trendCheck?.text ?? "No side" },
    ...all.filter((i) => CORE_IDS.has(i.id)),
    { id: "newsok", label: "News not against", state: newsOk ? "pass" : "fail", text: v.newsSide === "none" ? "No news reading" : `News ${v.newsSide.replace("_", " ")}` },
    { id: "late", label: "Not in the last 45 min", state: lateDay ? "fail" : "pass", text: minutesToClose === null ? "—" : `${minutesToClose} min to the close` },
  ];
  const expiry = g.rules.find((r) => r.key === "timing");
  const support: CheckItem[] = [
    ...all.filter((i) => !CORE_IDS.has(i.id) && !SKIP_IDS.has(i.id) && (i.state === "pass" || i.state === "fail")),
    ...g.rules
      .filter((r) => r.key === "trend" || r.key === "news" || r.key === "oi")
      .map((r) => ({ id: `t-${r.key}`, label: r.label, state: (r.ok ? "pass" : "fail") as CheckItem["state"], text: r.text })),
    { id: "expiry", label: "Not option expiry day", state: expiry?.text.startsWith("Option expiry") ? "fail" : "pass", text: expiry?.text.startsWith("Option expiry") ? "Expiry day — use the next expiry's strike" : "OK" },
  ];
  const sp = support.filter((i) => i.state === "pass").length;
  const supportPct = support.length ? Math.round((sp / support.length) * 100) : null;
  const coreFails = core.filter((i) => i.state === "fail");
  const ok = coreFails.length === 0 && supportPct !== null && supportPct >= SUPPORT_NEEDED * 100;
  const failed = [...coreFails.map((i) => i.label), ...(supportPct !== null && supportPct < SUPPORT_NEEDED * 100 ? [`Supporting checks ${supportPct}% (needs ${SUPPORT_NEEDED * 100}%)`] : [])];
  return { ok, core, support, supportPct, failed };
}

export interface QuickInput {
  symbol: "CRUDEOIL" | "NATURALGAS";
  c5: Candle[];
  c15: Candle[];
  v: Pick<TradeVerdict, "buyerZone" | "sellerZone">;
  mc: Pick<MarketChecklist, "levels" | "bias" | "atr15">;
  news: NewsPulse | null;
  now: number;
  minutesToClose: number | null;
}

export function quickTier({ symbol, c5, c15, v, mc, news, now, minutesToClose }: QuickInput): QuickTier {
  const closed5 = c5.filter((c) => Date.parse(c.date) < sessionBucketStart(now, 5)).sort((a, b) => a.date.localeCompare(b.date));
  const closed15 = c15.filter((c) => Date.parse(c.date) < sessionBucketStart(now, 15)).sort((a, b) => a.date.localeCompare(b.date));
  const none: QuickTier = { ok: false, side: null, counterTrend: false, items: [], plan: null, failed: ["Not enough candles"] };
  if (closed5.length < 25 || closed15.length < 21 || !mc.atr15) return none;
  const a5 = atr(closed5, 14);
  if (!a5) return none;

  // 1. The push: 2 of the last 3 candles strong one way, the last one too, and real distance covered.
  const reads = [3, 2, 1].map((k) => readCandle(closed5.slice(0, closed5.length - k + 1))!);
  const last = closed5[closed5.length - 1];
  const net = last.close - closed5[closed5.length - 4].close;
  const strong = (d: "up" | "down") => reads.filter((r) => r.strong && r.dir === d).length;
  const side: "CE" | "PE" | null =
    strong("up") >= 2 && reads[2].dir === "up" && net >= a5 ? "CE" : strong("down") >= 2 && reads[2].dir === "down" && -net >= a5 ? "PE" : null;
  const up = side === "CE";
  const lastRead = reads[2];
  const items: CheckItem[] = [
    {
      id: "push",
      label: "Strong one-sided 5-min push",
      state: side ? "pass" : "fail",
      text: side ? `${strong(up ? "up" : "down")} of the last 3 candles strong ${up ? "green" : "red"}, ${Math.abs(net / a5).toFixed(1)}× ATR in 15 min` : "No strong one-sided push in the last 15 min",
    },
  ];
  if (!side) return { ok: false, side: null, counterTrend: false, items, plan: null, failed: ["No strong 5-min push"] };

  items.push({ id: "qvol", label: "Volume behind it", state: lastRead.volumeRatio === null ? "na" : lastRead.volumeRatio >= 1.3 ? "pass" : "fail", text: lastRead.volumeRatio === null ? "Volume not reported" : `Last candle ${lastRead.volumeRatio}× average (needs 1.3×)` });

  // 2. The 15-minute agrees.
  const l15 = closed15[closed15.length - 1];
  const e15 = emaLast(closed15.map((c) => c.close), 20)!;
  const agree15 = up ? l15.close > l15.open && last.close > e15 : l15.close < l15.open && last.close < e15;
  items.push({ id: "q15", label: "15-min candle agrees", state: agree15 ? "pass" : "fail", text: `Last 15-min candle ${l15.close > l15.open ? "green" : "red"}, price ${last.close > e15 ? "above" : "below"} 15-min EMA20 ${rs(e15)}` });

  // 3. News -- and only WITH news may a quick trade go against the 1-hour trend.
  const counterTrend = (up && mc.bias === "short") || (!up && mc.bias === "long");
  const nv = newsVsSide(news, side);
  const newsOk = nv !== "against" && nv !== "strongly_against" && (!counterTrend || nv === "with");
  items.push({
    id: "qnews",
    label: counterTrend ? "News WITH it (against the 1-hour trend)" : "News not against",
    state: newsOk ? "pass" : "fail",
    text: !news?.available ? "No news reading" : `${news.net > 0 ? "+" : ""}${news.net} ${news.direction}${counterTrend && nv !== "with" ? " — counter-trend needs news support" : ""}`,
  });

  // 4. Not already over-stretched.
  const e5 = emaLast(closed5.map((c) => c.close), 20)!;
  const stretch = Math.abs(last.close - e5) / a5;
  items.push({ id: "qstretch", label: "Not over-stretched", state: stretch <= 3 ? "pass" : "fail", text: `${stretch.toFixed(1)}× ATR from the 5-min EMA20 (max 3)` });

  // 5. Tight stop and room to the next level / zone.
  const recent = closed5.slice(-3);
  const entry = last.close;
  const stop = r2(up ? Math.min(...recent.map((c) => c.low)) - 0.1 * a5 : Math.max(...recent.map((c) => c.high)) + 0.1 * a5);
  const risk = Math.abs(entry - stop);
  const lv = mc.levels;
  const zone = up ? v.sellerZone?.low : v.buyerZone?.high;
  const obstacles = [...(lv ? [lv.pivot, lv.r1, lv.r2, lv.s1, lv.s2, lv.pdh, lv.pdl] : []), ...(zone != null ? [zone] : [])].filter((x) => (up ? x > entry + 0.2 * a5 : x < entry - 0.2 * a5));
  const next = obstacles.length ? (up ? Math.min(...obstacles) : Math.max(...obstacles)) : null;
  const room = next !== null ? Math.abs(next - entry) : 3 * risk;
  const rr = risk > 0 ? Math.round((room / risk) * 10) / 10 : 0;
  const riskOk = risk > 0 && risk <= mc.atr15;
  items.push({
    id: "qroom",
    label: "Tight stop, 1.5× room to the next level",
    state: riskOk && rr >= 1.5 ? "pass" : "fail",
    text: !riskOk ? `Stop ${rs(risk)} away — wider than 1× ATR(15m), not a quick trade` : `Stop ${rs(stop)} · ${next !== null ? `next level ${rs(next)}` : "open space"} · ${rr}× room`,
  });

  // 6. Timing.
  const ev = scheduledEvents(now).find((e) => e.affects === symbol);
  const eventNear = !!ev && (ev.minutesAway <= 30 || 7 * 24 * 60 - ev.minutesAway <= 15);
  const late = minutesToClose !== null && minutesToClose < QUICK_HOLD_MIN;
  items.push({ id: "qtime", label: "No report due, not near the close", state: eventNear || late ? "fail" : "pass", text: eventNear ? `${ev!.name} too close` : late ? `${minutesToClose} min to the close` : "OK" });

  const failed = items.filter((i) => i.state === "fail").map((i) => i.label);
  const entryAt = Date.parse(last.date) + 5 * 60_000;
  const t1 = r2(up ? entry + 1.5 * risk : entry - 1.5 * risk);
  const t2Raw = up ? entry + 2.5 * risk : entry - 2.5 * risk;
  const t2 = r2(next !== null ? (up ? Math.min(t2Raw, next) : Math.max(t2Raw, next)) : t2Raw);
  const plan: QuickPlan = { side, entry: r2(entry), stop, t1, t2: up ? Math.max(t1, t2) : Math.min(t1, t2), rr, exitBy: hhmm(entryAt + QUICK_HOLD_MIN * 60_000), exitByIso: new Date(entryAt + QUICK_HOLD_MIN * 60_000).toISOString() };
  return { ok: failed.length === 0, side, counterTrend, items, plan, failed };
}

export function gradeTiers(trust: TrustTier, quick: QuickTier): Tiers {
  return { tier: trust.ok ? "trust" : quick.ok ? "quick" : "none", trust, quick };
}
