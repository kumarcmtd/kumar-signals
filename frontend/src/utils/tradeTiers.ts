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

  // 1. The push: 2 of the 3 candles BEFORE the last strong one way, >= 1 ATR.
  // 2'. The pause: the last candle rests and holds above half of the push.
  // Buying the third spike candle itself bought the top -- the first small
  // pullback then hit the tight stop. Entering after the pause, with the
  // stop under the push's halfway point, is the "comes back a bit, then
  // goes" entry.
  const L = closed5.length;
  const reads = [4, 3, 2].map((k) => readCandle(closed5.slice(0, L - k + 1))!);
  const last = closed5[L - 1];
  const pushStart = closed5[L - 5].close;
  const push = closed5.slice(L - 4, L - 1);
  const net = closed5[L - 2].close - pushStart;
  const strong = (d: "up" | "down") => reads.filter((r) => r.strong && r.dir === d).length;
  const side: "CE" | "PE" | null = strong("up") >= 2 && net >= a5 ? "CE" : strong("down") >= 2 && -net >= a5 ? "PE" : null;
  const up = side === "CE";
  const items: CheckItem[] = [
    {
      id: "push",
      label: "Strong one-sided 5-min push",
      state: side ? "pass" : "fail",
      text: side ? `${strong(up ? "up" : "down")} of 3 candles strong ${up ? "green" : "red"}, ${Math.abs(net / a5).toFixed(1)}× ATR` : "No strong one-sided push just before the last candle",
    },
  ];
  if (!side) return { ok: false, side: null, counterTrend: false, items, plan: null, failed: ["No strong 5-min push"] };

  const extreme = up ? Math.max(...push.map((c) => c.high)) : Math.min(...push.map((c) => c.low));
  const mid = (pushStart + extreme) / 2;
  const pauseRead = readCandle(closed5)!;
  const spiking = pauseRead.strong && pauseRead.dir === (up ? "up" : "down");
  const held = up ? last.low >= mid : last.high <= mid;
  items.push({
    id: "qpause",
    label: "Paused and held — not chasing the spike",
    state: !spiking && held ? "pass" : "fail",
    text: spiking ? "Still spiking — wait for a resting candle" : held ? `Rested above half the push (${rs(mid)})` : `Fell back past half the push (${rs(mid)}) — push failing`,
  });
  const vr = Math.max(...reads.map((r) => r.volumeRatio ?? 0));
  const volKnown = reads.some((r) => r.volumeRatio !== null);
  items.push({ id: "qvol", label: "Volume behind the push", state: !volKnown ? "na" : vr >= 1.3 ? "pass" : "fail", text: !volKnown ? "Volume not reported" : `Strongest push candle ${vr}× average (needs 1.3×)` });

  // 2. The 15-minute agrees.
  const l15 = closed15[closed15.length - 1];
  const e15 = emaLast(closed15.map((c) => c.close), 20)!;
  const agree15 = up ? l15.close > l15.open && last.close > e15 : l15.close < l15.open && last.close < e15;
  items.push({ id: "q15", label: "15-min candle agrees", state: agree15 ? "pass" : "fail", text: `Last 15-min candle ${l15.close > l15.open ? "green" : "red"}, price ${last.close > e15 ? "above" : "below"} 15-min EMA20 ${rs(e15)}` });

  // 3. News -- and only WITH news may a quick trade go against the 1-hour trend.
  const counterTrend = (up && mc.bias === "short") || (!up && mc.bias === "long");
  const nv = newsVsSide(news, side);
  // Against the 1-hour trend only on STRONG news for the side (net 35+).
  const strongNews = !!news?.available && (up ? news.net : -news.net) >= 35;
  const newsOk = nv !== "against" && nv !== "strongly_against" && (!counterTrend || strongNews);
  items.push({
    id: "qnews",
    label: counterTrend ? "Strong news WITH it (against the 1-hour trend)" : "News not against",
    state: newsOk ? "pass" : "fail",
    text: !news?.available ? "No news reading" : `${news.net > 0 ? "+" : ""}${news.net} ${news.direction}${counterTrend && !strongNews ? " — counter-trend needs strong news (35+)" : ""}`,
  });

  // 4. Not already over-stretched.
  const e5 = emaLast(closed5.map((c) => c.close), 20)!;
  const stretch = Math.abs(last.close - e5) / a5;
  items.push({ id: "qstretch", label: "Not over-stretched", state: stretch <= 3 ? "pass" : "fail", text: `${stretch.toFixed(1)}× ATR from the 5-min EMA20 (max 3)` });

  // 5. Tight stop and room to the next level / zone.
  const entry = last.close;
  // Under the push's halfway point (and the pause candle): if that breaks, the push has failed.
  const stop = r2(up ? Math.min(mid, last.low) - 0.15 * a5 : Math.max(mid, last.high) + 0.15 * a5);
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
    label: "Tight stop, 2× room to the next level",
    state: riskOk && rr >= 2 ? "pass" : "fail",
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
