// The trader's own pre-trade checklist, ticked live from the charts.
//
// Sections follow the checklist exactly: multi-timeframe trend, momentum,
// volume & OI, key levels, inventory & news, entry rules, risk, instrument.
// This file is the MARKET part (pure: candles + the Trade Card verdict), so
// the server can use it for the 💎 grade too. The PERSONAL part -- lot size
// from capital, trades taken today, the daily loss limit, the overnight
// NYMEX gap -- needs the phone's own settings and lives in the panel.
//
// "fail" items block a trade. "warn" items are shown but do not block (the
// checklist itself says "reduced size" or "be careful" for them). "info" is
// a level or fact to know. Nothing is guessed: no data -> "na".

import type { Candle } from "../types";
import type { TradeVerdict } from "./tradeVerdict";
import { atr, bollingerBands, emaLast, macd, pivotPoints, rsi } from "./indicators";
import { sessionBucketStart } from "./candleResample";
import { scheduledEvents } from "./timeProfileEngine";

export type ItemState = "pass" | "fail" | "warn" | "info" | "na";
export interface CheckItem {
  id: string;
  label: string;
  state: ItemState;
  text: string;
}
export interface CheckSection {
  title: string;
  items: CheckItem[];
}

export interface KeyLevels {
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
  pdh: number;
  pdl: number;
  pdc: number;
}

export interface TradePlan {
  side: "CE" | "PE";
  entry: number;
  stop: number; // farther of 1.5x ATR(15m) and the card's structure stop
  t1: number;
  t2: number;
  rr: number;
  atrStop: number;
}

export interface NgFade {
  side: "CE" | "PE"; // fade direction
  text: string;
  confirmed: boolean; // reversal candle back inside the band
  target: number; // middle band
  stop: number;
}

export interface MarketChecklist {
  sections: CheckSection[];
  blocking: CheckItem[]; // every "fail"
  ok: boolean; // no fail
  levels: KeyLevels | null;
  plan: TradePlan | null;
  ngFade: NgFade | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rs = (n: number) => `₹${n.toFixed(2)}`;
const istDay = (iso: string) => iso.slice(0, 10);

/** Previous session's high / low / close from 15-minute candles, and the floor pivots. */
export function keyLevels(c15: Candle[]): KeyLevels | null {
  if (!c15.length) return null;
  const today = istDay(c15[c15.length - 1].date);
  const prevDay = [...new Set(c15.map((c) => istDay(c.date)))].filter((d) => d < today).pop();
  if (!prevDay) return null;
  const prev = c15.filter((c) => istDay(c.date) === prevDay);
  const hlc = { date: prevDay, open: prev[0].open, high: Math.max(...prev.map((c) => c.high)), low: Math.min(...prev.map((c) => c.low)), close: prev[prev.length - 1].close };
  const p = pivotPoints(hlc);
  return { pivot: r2(p.pivot), r1: r2(p.r1), r2: r2(p.r2), s1: r2(p.s1), s2: r2(p.s2), pdh: r2(hlc.high), pdl: r2(hlc.low), pdc: r2(hlc.close) };
}

/** MACD line at each of the last `n` candles (oldest first). */
function macdLines(closes: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = closes.length - n; i < closes.length; i++) out.push(macd(closes.slice(0, i + 1))?.line ?? null);
  return out;
}

/** Price makes a new extreme in the last 8 candles but MACD does not (vs the 22 before). */
export function macdDivergence(c15: Candle[], side: "CE" | "PE"): boolean {
  if (c15.length < 70) return false;
  const win = c15.slice(-30);
  const lines = macdLines(c15.map((c) => c.close), 30);
  const recent = win.slice(-8);
  const prior = win.slice(0, -8);
  const pick = (arr: Candle[], offset: number, up: boolean) => {
    let best = offset;
    arr.forEach((c, i) => {
      if (up ? c.high > win[best].high : c.low < win[best].low) best = offset + i;
    });
    return best;
  };
  if (side === "CE") {
    const a = pick(prior, 0, true);
    const b = pick(recent, 22, true);
    return win[b].high > win[a].high && lines[a] !== null && lines[b] !== null && lines[b]! < lines[a]!;
  }
  const a = pick(prior, 0, false);
  const b = pick(recent, 22, false);
  return win[b].low < win[a].low && lines[a] !== null && lines[b] !== null && lines[b]! > lines[a]!;
}

export interface ChecklistInput {
  symbol: "CRUDEOIL" | "NATURALGAS";
  v: Pick<TradeVerdict, "action" | "side" | "checks" | "stop" | "t1" | "buyerZone" | "sellerZone" | "newsSide">;
  c15: Candle[];
  c60: Candle[];
  now: number;
}

export function marketChecklist({ symbol, v, c15: raw15, c60: raw60, now }: ChecklistInput): MarketChecklist {
  const c15 = raw15.filter((c) => Date.parse(c.date) < sessionBucketStart(now, 15)).sort((a, b) => a.date.localeCompare(b.date));
  const c60 = raw60.filter((c) => Date.parse(c.date) < sessionBucketStart(now, 60)).sort((a, b) => a.date.localeCompare(b.date));
  const side = v.side;
  const up = side === "CE";
  const check = (key: string) => v.checks.find((c) => c.key === key);
  const fromCheck = (id: string, label: string, key: string): CheckItem => {
    const c = check(key);
    return { id, label, state: !c ? "na" : c.state === "fail" ? "fail" : c.state === "na" ? "na" : "pass", text: c?.text ?? "—" };
  };
  const closes15 = c15.map((c) => c.close);
  const price = closes15[closes15.length - 1] ?? null;
  const a15 = atr(c15, 14);

  // ---- 1. Multi-timeframe trend ----
  const closes60 = c60.map((c) => c.close);
  const h20 = emaLast(closes60, 20);
  const h50 = emaLast(closes60, 50);
  const hp = closes60[closes60.length - 1];
  const longBias = h20 !== null && h50 !== null && hp > h20 && h20 > h50;
  const shortBias = h20 !== null && h50 !== null && hp < h20 && h20 < h50;
  const e20 = emaLast(closes15, 20);
  const e20Before = emaLast(closes15.slice(0, -3), 20);
  const m15 = e20 !== null && e20Before !== null && price !== null ? (up ? price > e20 && e20 > e20Before : price < e20 && e20 < e20Before) : null;
  const trend: CheckSection = {
    title: "Multi-timeframe trend",
    items: [
      {
        id: "h1",
        label: "1-hour: price vs EMA 20 vs EMA 50",
        state: h20 === null || h50 === null || !side ? "na" : (up ? longBias : shortBias) ? "pass" : "fail",
        text: h20 === null || h50 === null ? "Not enough 1-hour candles" : `${longBias ? "Long bias" : shortBias ? "Short bias" : "No clear bias"} — price ${rs(hp)}, EMA20 ${rs(h20)}, EMA50 ${rs(h50)}`,
      },
      { id: "m15", label: "15-min confirms the 1-hour direction", state: m15 === null || !side ? "na" : m15 ? "pass" : "fail", text: e20 === null ? "—" : `Price ${up ? "above" : "below"} a ${up ? "rising" : "falling"} 15-min EMA20 ${rs(e20)}: ${m15 ? "yes" : "no"}` },
      fromCheck("m5", "5-min candles steady — used only to time the entry", "candles"),
    ],
  };

  // ---- 2. Momentum ----
  const r = rsi(closes15);
  const rBefore = rsi(closes15.slice(0, -3));
  const rising = r !== null && rBefore !== null && r > rBefore;
  const rsiState: ItemState = r === null || !side ? "na" : up ? (r > 70 ? "fail" : r >= 40 && rising ? "pass" : "fail") : r < 30 ? "fail" : r <= 60 && !rising ? "pass" : "fail";
  const rsiText =
    r === null
      ? "—"
      : `RSI ${r.toFixed(0)} ${rising ? "rising" : "falling"}${up && r > 70 ? " — overbought, don't chase longs" : !up && r < 30 ? " — oversold, don't chase shorts" : up ? " (want 40–70 and rising)" : " (want 30–60 and falling)"}`;
  const m = macd(closes15);
  const mPrev = macd(closes15.slice(0, -1));
  const macdOk = m && mPrev && side ? (up ? m.line > m.signal && m.histogram > mPrev.histogram : m.line < m.signal && m.histogram < mPrev.histogram) : null;
  const div = side ? macdDivergence(c15, side) : false;
  const momentum: CheckSection = {
    title: "Momentum (15-min)",
    items: [
      { id: "rsi", label: "RSI (14) zone and direction", state: rsiState, text: rsiText },
      { id: "macd", label: "MACD crossed this way, histogram growing", state: macdOk === null ? "na" : macdOk ? "pass" : "fail", text: m ? `MACD ${m.line > m.signal ? "above" : "below"} signal, histogram ${mPrev && m.histogram > mPrev.histogram ? "growing up" : "growing down"}` : "—" },
      { id: "div", label: "No MACD divergence against the trade", state: !side || c15.length < 70 ? "na" : div ? "fail" : "pass", text: div ? `Price made a new ${up ? "high" : "low"} but MACD did not — move is tiring` : "No divergence" },
    ],
  };

  // ---- 3. Volume & OI ----
  const oiC = check("oi");
  const volC = check("strength");
  const flat = oiC?.text.startsWith("No clear OI") && volC?.state === "fail";
  const volOi: CheckSection = {
    title: "Volume & open interest",
    items: [fromCheck("vol", "Volume above its 20-candle average", "strength"), fromCheck("oi", "OI confirms (build-up, not covering)", "oi"), { id: "flat", label: "Not 'volume + OI both flat'", state: !oiC ? "na" : flat ? "fail" : "pass", text: flat ? "No conviction — skip" : "Some conviction present" }],
  };

  // ---- 4. Key levels ----
  const lv = keyLevels(c15);
  const entry = price;
  const cardRisk = v.stop !== null && entry !== null ? Math.abs(entry - v.stop) : null;
  let blocker: { name: string; at: number } | null = null;
  if (lv && entry !== null && side && a15) {
    const named: [string, number][] = [["Pivot", lv.pivot], ["R1", lv.r1], ["R2", lv.r2], ["S1", lv.s1], ["S2", lv.s2], ["Prev high", lv.pdh], ["Prev low", lv.pdl]];
    const ahead = named.filter(([, x]) => (up ? x > entry + 0.1 * a15 : x < entry - 0.1 * a15)).sort((a, b) => (up ? a[1] - b[1] : b[1] - a[1]));
    if (ahead[0]) blocker = { name: ahead[0][0], at: ahead[0][1] };
  }
  const blockGap = blocker && entry !== null ? Math.abs(blocker.at - entry) : null;
  const levelRoom = blockGap !== null && cardRisk !== null ? blockGap >= cardRisk : null;
  const zone = up ? v.buyerZone : v.sellerZone;
  const levels: CheckSection = {
    title: "Key levels",
    items: [
      { id: "piv", label: "Daily pivot, R1/R2, S1/S2", state: lv ? "info" : "na", text: lv ? `P ${rs(lv.pivot)} · R1 ${rs(lv.r1)} · R2 ${rs(lv.r2)} · S1 ${rs(lv.s1)} · S2 ${rs(lv.s2)}` : "Previous session not in the data" },
      { id: "pd", label: "Previous day high / low / close", state: lv ? "info" : "na", text: lv ? `H ${rs(lv.pdh)} · L ${rs(lv.pdl)} · C ${rs(lv.pdc)}` : "—" },
      {
        id: "room",
        label: "No key level blocking the move",
        state: levelRoom === null ? (blocker ? "na" : "pass") : levelRoom ? "pass" : "fail",
        text: blocker ? `Next level ${blocker.name} ${rs(blocker.at)}${levelRoom === false ? " — closer than the risk; price may stall there" : ""}` : "Open space to the next level",
      },
      { id: "sr", label: "Support / resistance zone marked", state: zone ? "pass" : side ? "warn" : "na", text: zone ? `${up ? "Buyer" : "Seller"} zone ${rs(zone.low)}–${rs(zone.high)}` : "No nearby zone to lean on" },
    ],
  };

  // ---- 5. Inventory & news ----
  const events = scheduledEvents(now);
  const ev = events.find((e) => e.affects === symbol);
  const soon = ev && ev.minutesAway >= 0 && ev.minutesAway <= 120;
  const justOut = events.some((e) => e.affects === symbol && 7 * 24 * 60 - e.minutesAway <= 15);
  const ist = new Date(now + 5.5 * 3600_000);
  const tuesday = ist.getUTCDay() === 2;
  const news: CheckSection = {
    title: "Inventory & news",
    items: [
      { id: "eia", label: `No ${symbol === "CRUDEOIL" ? "EIA crude" : "EIA gas storage"} report in the next 2 hours`, state: soon || justOut ? "fail" : "pass", text: soon ? `${ev!.name} at ${ev!.istLabel} — in ${ev!.minutesAway} min` : justOut ? "Report just out — let the spike settle 15 min" : `Next: ${ev?.name ?? "report"} ${ev?.istLabel ?? ""}` },
      ...(symbol === "CRUDEOIL"
        ? [{ id: "api", label: "API report (Tuesday)", state: (tuesday ? "warn" : "pass") as ItemState, text: tuesday ? "API lands tonight after MCX shuts (~2 AM IST) — reduced size, don't carry overnight" : "Not today" }]
        : []),
      fromCheck("news", "OPEC / war / weather headlines not against", "news"),
    ],
  };

  // ---- 6. Entry & risk plan (the trader's 1.5x ATR stop) ----
  let plan: TradePlan | null = null;
  if (side && entry !== null && a15 && v.t1 !== null) {
    const atrStop = r2(up ? entry - 1.5 * a15 : entry + 1.5 * a15);
    const stop = v.stop === null ? atrStop : up ? Math.min(atrStop, v.stop) : Math.max(atrStop, v.stop);
    const risk = Math.abs(entry - stop);
    const t1 = v.t1;
    const rrv = risk > 0 ? Math.round((Math.abs(t1 - entry) / risk) * 10) / 10 : 0;
    plan = { side, entry: r2(entry), stop: r2(stop), t1: r2(t1), t2: r2(up ? Math.max(t1, entry + 3 * risk) : Math.min(t1, entry - 3 * risk)), rr: rrv, atrStop };
  }
  const entryRisk: CheckSection = {
    title: "Entry & risk",
    items: [
      fromCheck("pull", "Pulled back to a level, reversal candle, volume spike", "zone"),
      { id: "atr", label: "Stop = 1.5× ATR (or beyond the zone)", state: plan ? "pass" : "na", text: plan && a15 ? `ATR(15m) ${a15.toFixed(2)} → stop ${rs(plan.stop)}` : "—" },
      { id: "rr", label: "Risk : reward at least 1 : 2", state: !plan ? "na" : plan.rr >= 2 ? "pass" : "fail", text: plan ? `1 : ${plan.rr} to T1 ${rs(plan.t1)}${plan.rr >= 3 ? " (1:3+ — ideal)" : ""}` : "—" },
    ],
  };

  // ---- 7. Instrument rules ----
  let ngFade: NgFade | null = null;
  if (symbol === "NATURALGAS" && c15.length >= 25 && r !== null && a15) {
    const bb = bollingerBands(closes15.slice(0, -1), 20, 2);
    const last = c15[c15.length - 1];
    const prevC = c15[c15.length - 2];
    if (bb && prevC.high >= bb.upper && r >= 65) {
      const confirmed = last.close < last.open && last.close < bb.upper;
      ngFade = { side: "PE", confirmed, target: r2(bb.middle), stop: r2(Math.max(prevC.high, last.high) + 0.2 * a15), text: `Stretched above the upper band (RSI ${r.toFixed(0)})${confirmed ? " and a red candle closed back inside" : " — wait for a red candle back inside"}` };
    } else if (bb && prevC.low <= bb.lower && r <= 35) {
      const confirmed = last.close > last.open && last.close > bb.lower;
      ngFade = { side: "CE", confirmed, target: r2(bb.middle), stop: r2(Math.min(prevC.low, last.low) - 0.2 * a15), text: `Stretched below the lower band (RSI ${r.toFixed(0)})${confirmed ? " and a green candle closed back inside" : " — wait for a green candle back inside"}` };
    }
  }
  const instrument: CheckSection = {
    title: symbol === "CRUDEOIL" ? "Crude Oil rules" : "Natural Gas rules",
    items:
      symbol === "CRUDEOIL"
        ? [{ id: "tf", label: "Trend-following only (no fading the 1-hour)", state: !side ? "na" : (up ? longBias : shortBias) ? "pass" : "fail", text: (up ? longBias : shortBias) ? "Trade is with the 1-hour trend" : "Trade would be against the 1-hour trend" }]
        : [
            { id: "mr", label: "Mean reversion at Bollinger extremes", state: ngFade ? "info" : "na", text: ngFade ? `Fade setup ${ngFade.side}: ${ngFade.text}` : "Price not at a band extreme — no fade setup" },
            { id: "wx", label: "Weather + Thursday storage checked", state: "info", text: "See Price-Alerts → Weather & Gas storage cards" },
          ],
  };

  const sections = [trend, momentum, volOi, levels, news, entryRisk, instrument];
  const blocking = sections.flatMap((s) => s.items).filter((i) => i.state === "fail");
  return { sections, blocking, ok: blocking.length === 0 && !!side, levels: lv, plan, ngFade };
}
