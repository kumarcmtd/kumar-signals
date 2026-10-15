// THE TRADE CARD -- one answer from every check at once.
//
// Separate engines read different time frames, so they can disagree (Ai20-20
// reads 5-minute moves; AI Verify Pro reads 15m/1h/4h; news reads headlines).
// This card is the referee. It says exactly one of:
//   TRADE CE / TRADE PE  -- all six checks pass (full green / full red)
//   WAIT CE / WAIT PE    -- right side, wrong moment: wait for price to come
//                           back to the buyer (seller) zone and bounce
//   AVOID                -- sideways, conflicting, or news against the chart
// The six checks: 1 trend (15m/1h/4h confirmed), 2 five-minute candles
// steady (not choppy, not against), 3 the last candle strong with volume,
// 4 news not against, 5 entry location (near a zone, not stretched, room to
// the next opposite zone at least 1.5x the risk), 6 open interest: fresh
// buyers for CE (long build-up), fresh sellers for PE (short build-up).
//
// Built ONLY from finished candles and the news reading, so it changes at
// most once per 5-minute candle -- the live tick does not flip it. The one
// exception is safety: if the live price breaks the stop it says so at once.
// Not a forecast; max confidence is the engine's 94.

import type { Candle } from "../types";
import type { DecisionResult } from "./buyDecisionEngine";
import { atr } from "./indicators";
import { sessionBucketStart } from "./candleResample";
import { trendPulse, type TrendPulse } from "./trendPulse";
import { newsVsSide, type NewsPulse } from "./newsPulse";
import { findZones, type Zone } from "./zones";
import { classifyBuildup, HOUR_BANDS, pctChange, type BuildupKind } from "./oiBuildup";

export type TradeAction = "TRADE_CE" | "TRADE_PE" | "WAIT_CE" | "WAIT_PE" | "AVOID" | "CLOSED" | "NO_DATA";
export type CheckState = "pass" | "fail" | "na";

export interface TradeCheck {
  key: "trend" | "candles" | "strength" | "news" | "zone" | "oi";
  label: string;
  state: CheckState;
  text: string;
}

export interface TradeVerdict {
  action: TradeAction;
  side: "CE" | "PE" | null;
  headline: string;
  reason: string;
  checks: TradeCheck[];
  passed: number;
  entryZone: { low: number; high: number } | null; // where to buy on a pullback
  stop: number | null; // futures level
  t1: number | null;
  rr: number | null; // reward to T1 / risk
  buyerZone: Zone | null;
  sellerZone: Zone | null;
  basedOn: string | null; // the last finished 5-minute candle, IST HH:MM
  nextAt: string | null; // when the card can next change
  pulse: TrendPulse | null;
  /** Extra facts the Ai-Trust grade reads (utils/trustGrade). */
  strength: number | null; // AI Verify agreement, max 94
  newsSide: "with" | "against" | "strongly_against" | "neutral" | "none";
  oiKind: BuildupKind | null;
  bounce: boolean; // entry off a buyer/seller zone
}

export interface CandleRead {
  dir: "up" | "down" | "flat";
  strong: boolean;
  volumeRatio: number | null;
  text: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const hhmm = (ms: number) => new Date(ms + 5.5 * 3600_000).toISOString().slice(11, 16);
const rs = (n: number) => `₹${n.toFixed(2)}`;

/** The last finished 5-minute candle: direction, strength (body, close near the extreme) and volume vs average. */
export function readCandle(closed: Candle[]): CandleRead | null {
  const last = closed[closed.length - 1];
  if (!last) return null;
  const range = last.high - last.low;
  if (range <= 0) return { dir: "flat", strong: false, volumeRatio: null, text: "flat candle" };
  const body = Math.abs(last.close - last.open) / range;
  const pos = (last.close - last.low) / range;
  const dir = last.close > last.open && body >= 0.2 ? "up" : last.close < last.open && body >= 0.2 ? "down" : "flat";
  const strong = body >= 0.5 && (dir === "up" ? pos >= 0.7 : dir === "down" ? pos <= 0.3 : false);
  const prior = closed.slice(-21, -1).map((c) => c.volume ?? 0).filter((v) => v > 0);
  const avg = prior.length >= 10 ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  const volumeRatio = avg > 0 && (last.volume ?? 0) > 0 ? Math.round(((last.volume ?? 0) / avg) * 10) / 10 : null;
  const word = dir === "up" ? "green" : dir === "down" ? "red" : "small";
  const text = `${strong ? "Strong" : "Weak"} ${word} candle (body ${Math.round(body * 100)}%)${volumeRatio !== null ? `, volume ${volumeRatio}× average` : ", volume not reported"}`;
  return { dir, strong, volumeRatio, text };
}

// What each failed check is waiting for, in plain words.
const NEED: Record<TradeCheck["key"], (up: boolean) => string> = {
  trend: () => "the trend to confirm",
  candles: (up) => `steady ${up ? "up" : "down"} 5-min candles`,
  strength: (up) => `a strong ${up ? "green" : "red"} candle with volume`,
  news: () => "news to stop going against it",
  zone: () => "a better entry price",
  oi: (up) => `fresh ${up ? "buying (long build-up)" : "selling (short build-up)"} in open interest`,
};

/**
 * Price + open interest over the last hour of finished 15-minute futures
 * candles. Zero OI is Upstox's "not reported", never a real reading.
 */
export function readOi(closed15: Candle[]): { kind: BuildupKind; priceChangePct: number | null; oiChangePct: number | null } {
  const win = closed15.slice(-5); // 4 changes = 1 hour
  const withOi = win.filter((c) => (c.oi ?? 0) > 0);
  if (withOi.length < 2) return { kind: "no-data", priceChangePct: null, oiChangePct: null };
  const first = withOi[0];
  const last = withOi[withOi.length - 1];
  const r = classifyBuildup(pctChange(first.close, last.close), pctChange(first.oi, last.oi), HOUR_BANDS);
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return { kind: r.kind, priceChangePct: round(r.priceChangePct), oiChangePct: round(r.oiChangePct) };
}

const OI_WORDS: Record<BuildupKind, string> = {
  "long-buildup": "Long build-up (price ↑, OI ↑) — new buyers",
  "short-buildup": "Short build-up (price ↓, OI ↑) — new sellers",
  "short-covering": "Short covering (price ↑, OI ↓) — sellers exiting, rally can fade",
  "long-unwinding": "Long unwinding (price ↓, OI ↓) — buyers exiting, fall can fade",
  "no-clear-signal": "No clear OI move in the last hour",
  "no-data": "OI not reported — check skipped",
};

export interface VerdictInput {
  result: Pick<DecisionResult, "verdict" | "side" | "strength"> | null;
  c5: Candle[];
  c15: Candle[];
  news: NewsPulse | null;
  now: number;
  marketOpen: boolean;
}

export function tradeVerdict({ result, c5, c15, news, now, marketOpen }: VerdictInput): TradeVerdict {
  const forming = sessionBucketStart(now, 5);
  const closed5 = [...c5].filter((c) => Date.parse(c.date) < forming).sort((a, b) => a.date.localeCompare(b.date));
  const closed15 = [...c15].filter((c) => Date.parse(c.date) < sessionBucketStart(now, 15)).sort((a, b) => a.date.localeCompare(b.date));
  const last5 = closed5[closed5.length - 1];
  const price = last5?.close ?? null;
  const pulse = closed5.length ? trendPulse(closed5, now, null) : null;
  const zones = price !== null ? findZones(closed15, price) : null;
  const a5 = atr(closed5.slice(-60), 14);
  const basedOn = last5 ? hhmm(Date.parse(last5.date)) : null;
  const nextAt = hhmm(forming + 5 * 60_000);
  const base = { checks: [] as TradeCheck[], passed: 0, entryZone: null, stop: null, t1: null, rr: null, buyerZone: zones?.buyer[0] ?? null, sellerZone: zones?.seller[0] ?? null, basedOn, nextAt, pulse, strength: result?.strength ?? null, newsSide: "none" as TradeVerdict["newsSide"], oiKind: null as BuildupKind | null, bounce: false };

  if (!marketOpen) return { ...base, action: "CLOSED", side: result?.side ?? null, headline: "MARKET CLOSED", reason: "No trade. Zones below are for the next open.", nextAt: null };
  if (!result || !pulse || !zones || price === null || !a5) {
    return { ...base, action: "NO_DATA", side: null, headline: "READING THE CHARTS", reason: "Not enough finished candles yet — no call until there are." };
  }

  const side = result.side;
  const up = side === "CE";
  const A = zones.atr15;

  // 1. Trend -- the slow, strict engine (closed 15m/1h/4h).
  const confirmed = !!side && result.verdict === (up ? "BUY_CE" : "BUY_PE");
  const formingSide = !!side && result.verdict === (up ? "FORMING_CE" : "FORMING_PE");
  const trend: TradeCheck = {
    key: "trend",
    label: "Trend 15m · 1h · 4h",
    state: confirmed ? "pass" : "fail",
    text: confirmed ? `Confirmed ${up ? "UP" : "DOWN"} on closed candles (${result.strength} agree)` : formingSide ? `Forming ${side} — not confirmed yet` : side ? `Only leaning ${side}` : "No clear trend",
  };

  // 2. Five-minute candles -- steady with the side, not choppy, not against.
  const withPulse = up ? ["STEADY_UP", "BUILDING_UP"] : ["STEADY_DOWN", "BUILDING_DOWN"];
  const againstPulse = up ? ["STEADY_DOWN", "BUILDING_DOWN"] : ["STEADY_UP", "BUILDING_UP"];
  const candles: TradeCheck = {
    key: "candles",
    label: "5-min candles",
    state: side && withPulse.includes(pulse.state) ? "pass" : "fail",
    text: pulse.title + (pulse.state === "CHOPPY" ? " — up-down, no direction" : ""),
  };

  // 3. The last finished candle: strong in the side's direction, with volume.
  const cr = readCandle(closed5)!;
  const volOk = cr.volumeRatio === null || cr.volumeRatio >= 1.1;
  const strengthOk = !!side && cr.strong && cr.dir === (up ? "up" : "down") && volOk;
  const strength: TradeCheck = {
    key: "strength",
    label: "Candle + volume",
    state: strengthOk ? "pass" : "fail",
    text: cr.text + (cr.strong && !volOk ? " — volume too thin to trust" : ""),
  };

  // 4. News (risk premium) -- must not be against the side.
  const nv = side ? newsVsSide(news, side) : "neutral";
  const newsCheck: TradeCheck = {
    key: "news",
    label: "News",
    state: !news?.available ? "na" : nv === "against" || nv === "strongly_against" ? "fail" : "pass",
    text: !news?.available ? "No news reading — trade on charts only, smaller size" : `${news.net > 0 ? "+" : ""}${news.net} ${news.direction}${nv === "with" ? " — supports" : nv === "neutral" ? " — not against" : " — AGAINST the chart"}`,
  };

  // 5. Location -- the buyer zone (CE) or seller zone (PE) to lean on, the
  // opposite zone as the target, and enough room between them.
  const own = up ? zones.buyer.find((z) => price - z.high <= 3 * A) ?? null : zones.seller.find((z) => z.low - price <= 3 * A) ?? null;
  const opp = up ? zones.seller[0] ?? null : zones.buyer[0] ?? null;
  const recent = closed5.slice(-3);
  const swing = up ? Math.min(...recent.map((c) => c.low)) : Math.max(...recent.map((c) => c.high));
  // "Reached" allows a little short of the zone: pullbacks often turn just before it.
  const touchedZone = !!own && (up ? swing <= own.high + 0.35 * A && price > own.low : swing >= own.low - 0.35 * A && price < own.high);
  // Stop just beyond the zone the trade leans on (or the last 3 candles' swing).
  const stopBase = own && touchedZone ? (up ? Math.min(own.low, swing) : Math.max(own.high, swing)) : swing;
  const stop = r2(up ? stopBase - 0.15 * A : stopBase + 0.15 * A);
  const risk = up ? price - stop : stop - price;
  const t1 = opp ? (up ? opp.low : opp.high) : r2(up ? price + 2 * risk : price - 2 * risk);
  const reward = up ? t1 - price : price - t1;
  const rr = risk > 0 ? Math.round((reward / risk) * 10) / 10 : null;
  const stretched = !!pulse.stretched && pulse.stretched.side === (up ? "up" : "down");
  // A stop under a real zone may sit a little wider than a momentum stop.
  const riskOk = risk > 0 && risk <= (touchedZone ? 2 : 1.5) * A;
  const locOk = !!side && !stretched && riskOk && rr !== null && rr >= 1.5;
  const zone: TradeCheck = {
    key: "zone",
    label: "Entry spot + room",
    state: locOk ? "pass" : "fail",
    text: !side
      ? "—"
      : stretched
        ? `Price already ran far (${pulse.stretched!.atrs}× ATR) — late, don't chase`
        : !riskOk
          ? `Stop would be ${rs(Math.max(risk, 0))} away — too wide for a clean entry`
          : rr !== null && rr < 1.5
            ? `Only ${rr}× reward to the ${up ? "seller" : "buyer"} zone at ${rs(t1)} — not enough room`
            : `${touchedZone ? `Bounced from the ${up ? "buyer" : "seller"} zone · ` : ""}room to ${rs(t1)} (${rr}× the risk)`,
  };

  // 6. Open interest -- is fresh money behind the side? CE wants new buyers
  // (long build-up), PE new sellers (short build-up). A move made only of the
  // other side exiting (short covering / long unwinding) often fades. On a
  // bounce off a zone the last hour still holds the pullback, so there it is
  // enough that no fresh positions are being built AGAINST the side.
  const oiRead = readOi(closed15);
  const fresh = up ? "long-buildup" : "short-buildup";
  const pullbackOk = up ? ["long-unwinding", "no-clear-signal"] : ["short-covering", "no-clear-signal"];
  const oiCheck: TradeCheck = {
    key: "oi",
    label: "Open interest (1h)",
    state: oiRead.kind === "no-data" ? "na" : oiRead.kind === fresh || (touchedZone && pullbackOk.includes(oiRead.kind)) ? "pass" : "fail",
    text:
      OI_WORDS[oiRead.kind] +
      (oiRead.oiChangePct !== null && oiRead.priceChangePct !== null ? ` · price ${oiRead.priceChangePct > 0 ? "+" : ""}${oiRead.priceChangePct}%, OI ${oiRead.oiChangePct > 0 ? "+" : ""}${oiRead.oiChangePct}%` : ""),
  };

  const checks = [trend, candles, strength, newsCheck, zone, oiCheck];
  const passed = checks.filter((c) => c.state !== "fail").length;
  const plan = {
    checks,
    passed,
    stop: side ? stop : null,
    t1: side ? r2(t1) : null,
    rr: side ? rr : null,
    pulse,
    newsSide: (!news?.available ? "none" : nv) as TradeVerdict["newsSide"],
    oiKind: oiRead.kind,
    bounce: touchedZone,
  };
  const ownBand = own ? { low: own.low, high: own.high } : pulse.stretched ? { low: r2(pulse.stretched.pullbackTo - 0.25 * A), high: r2(pulse.stretched.pullbackTo + 0.25 * A) } : null;

  // ---- the one answer ----
  if (!side) return { ...base, ...plan, action: "AVOID", side: null, headline: "AVOID — SIDEWAYS", reason: "No trend on 15m/1h/4h. Sideways markets eat option premium — stay out." };
  if (result.verdict === "EVENT_WAIT") return { ...base, ...plan, action: "AVOID", side, headline: "AVOID — EVENT RISK", reason: "A scheduled report is due — price can jump either way. Stay out until it is out." };
  if (nv === "strongly_against") {
    return { ...base, ...plan, action: "AVOID", side, headline: "AVOID — NEWS vs CHART", reason: `Chart says ${side} but the news is strongly ${up ? "bearish" : "bullish"} (${news!.net > 0 ? "+" : ""}${news!.net}). A headline can wipe the move — stay out.` };
  }
  if (!confirmed && !formingSide) {
    return { ...base, ...plan, action: "AVOID", side, headline: pulse.state === "CHOPPY" || pulse.state === "FLAT" ? "AVOID — SIDEWAYS" : "AVOID — NO TREND YET", reason: `Only a weak ${side} lean. Wait until the trend confirms.` };
  }
  if (checks.every((c) => c.state !== "fail")) {
    return {
      ...base,
      ...plan,
      action: up ? "TRADE_CE" : "TRADE_PE",
      side,
      entryZone: null,
      headline: `TRADE ${side} NOW`,
      reason: `All ${checks.length} checks pass${touchedZone ? ` — bounced from the ${up ? "buyer" : "seller"} zone` : ""}. Exit if a 5-min candle closes beyond ${rs(stop)}.`,
    };
  }
  // A bounce from the zone can come while the 30-minute read still shows the
  // pullback -- that is the entry the user is waiting for, so allow it when
  // every other check passes.
  const bounce = confirmed && touchedZone && strengthOk && newsCheck.state !== "fail" && locOk && oiCheck.state !== "fail";
  if (bounce) {
    return { ...base, ...plan, action: up ? "TRADE_CE" : "TRADE_PE", side, entryZone: null, headline: `TRADE ${side} NOW`, reason: `Pullback to the ${up ? "buyer" : "seller"} zone and a strong ${up ? "green" : "red"} candle off it. Exit if a 5-min candle closes beyond ${rs(stop)}.` };
  }
  // Right side, wrong moment.
  const own5Against = againstPulse.includes(pulse.state);
  const zoneTxt = ownBand ? `${rs(ownBand.low)} – ${rs(ownBand.high)}` : null;
  const reason = !confirmed
    ? `${side} setup is forming. Not yet.${zoneTxt ? ` Best entry near ${zoneTxt}.` : ""}`
    : stretched
      ? `Trend is ${up ? "up" : "down"} but price already ran. Wait for a pullback${zoneTxt ? ` to ${zoneTxt}` : ""}, then a strong ${up ? "green" : "red"} 5-min candle.`
      : own5Against
        ? `Trend is ${up ? "up" : "down"}; price is pulling back now. Let it reach the ${up ? "buyer" : "seller"} zone${zoneTxt ? ` ${zoneTxt}` : ""} and turn with a strong ${up ? "green" : "red"} candle.`
        : `Trend is ${up ? "up" : "down"}. Still waiting for: ${checks
            .filter((c) => c.state === "fail")
            .map((c) => NEED[c.key](up))
            .join(", ")}.`;
  return { ...base, ...plan, action: up ? "WAIT_CE" : "WAIT_PE", side, entryZone: ownBand, headline: confirmed ? `WAIT — ${side} ON PULLBACK` : `WAIT — ${side} SETUP FORMING`, reason };
}
