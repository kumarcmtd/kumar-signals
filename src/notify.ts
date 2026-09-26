// ntfy push notifications: Best Call and Ai20-20 background checks.

import { analyzeImmediate, LOT_SIZE as TWENTY_LOT_SIZE, projectPremium20, scanForAiTwenty } from "../frontend/src/utils/aiTwentyTwentyEngine";
import { type BestCallPick, eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall } from "../frontend/src/utils/bestCallSelector";
import { evaluateDirectionalGate } from "../frontend/src/utils/directionalGateEngine";
import { findEliteSignal } from "../frontend/src/utils/eliteSignal";
import { scanAllSetups } from "../frontend/src/utils/kimiScanner";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { analyzeTimeframe } from "../frontend/src/utils/timeframeEngine";
import { type Candle, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { getCandlesForTF } from "./signals";
import { getNearestFuture } from "./upstox";

// ---- Best Call background push notifications (ntfy.sh) ----
// A Cron Trigger (see wrangler.jsonc) calls runBestCallNotificationCheck on a
// schedule, independent of anyone having the app open -- unlike the
// browser-notification alert engine on the frontend (which only runs while a
// tab is open), this is what lets a call reach the user even with the site
// fully closed. Deliberately built on ntfy.sh (a free, no-signup push relay:
// just an HTTPS POST to a topic URL) instead of hand-rolling the raw Web
// Push protocol -- that would need per-subscription VAPID/AES-GCM crypto
// this environment has no way to verify end-to-end against a real device,
// and a broken crypto path could break at runtime in ways that are very
// hard to diagnose. ntfy trades a small amount of trust in a third-party
// relay for something that's simple, free, and immediately testable by the
// user via the "Send test notification" button in Settings.
export const NTFY_TOPIC_KV_KEY = "ntfy_topic";

const CRON_TIMEFRAMES: { tf: string; label: string }[] = [
  { tf: "15", label: "15 Minutes" },
  { tf: "30", label: "30 Minutes" },
  { tf: "60", label: "1 Hour" },
  { tf: "240", label: "4 Hours" },
];
// Same "next higher timeframe confirms the trend" mapping the Directional
// Gate page's own useDirectionalGateSuite hook uses on the frontend.
const CRON_TREND_TF: Record<string, string> = { "15": "60", "30": "60", "60": "240", "240": "1D" };

function bestCallSignature(pick: BestCallPick): string {
  return `${pick.strike}-${pick.optSide}-${pick.source}`;
}

export async function sendNtfyNotification(topic: string, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: { Title: title, Priority: "high", Tags: "chart_with_upwards_trend" },
      body,
    });
    if (!res.ok) return { ok: false, error: `ntfy.sh responded HTTP ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? "ntfy.sh request failed" };
  }
}

// ---- Ai20-20 background push (ntfy.sh) ----
//
// The page this is built for is the one actually traded, and the trader is at
// work when its calls fire. Everything below therefore runs on the Cron with
// no browser open, importing the SAME pure engine the page renders
// (aiTwentyTwentyEngine) so a pushed call and an on-screen call can never
// disagree.
//
// The one thing the Worker does not get for free is premium MOMENTUM. The page
// builds it from a rolling buffer of ATM CE/PE prices collected while it is
// open; the Worker keeps the equivalent buffer in KV across Cron ticks. The
// buffer resets whenever the ATM strike rolls, exactly as the page's does --
// an old strike's premium history says nothing about a freshly repriced one.
const TWENTY_SAMPLES_KV_KEY = "twenty20:samples:v1";
const TWENTY_MAX_SAMPLES = 12;

interface TwentySampleBuffer {
  [symbol: string]: { strike: number | null; ce: number[]; pe: number[] };
}

function twentyMomentumPct(samples: number[]): number | null {
  if (samples.length < 3 || samples[0] <= 0) return null;
  return ((samples[samples.length - 1] - samples[0]) / samples[0]) * 100;
}

function twentySignature(symbol: string, strike: number, optSide: string, entry: number): string {
  return `${symbol}-${strike}-${optSide}-${entry.toFixed(2)}`;
}

/**
 * One Cron tick of the Ai20-20 watcher.
 *
 * Deliberately gated on market hours: outside them there is nothing to enter,
 * the sample buffer would fill with stale prices, and every tick would be a KV
 * write against a 1,000/day free limit for no benefit.
 */
export async function runTwentyTwentyNotificationCheck(env: Env): Promise<void> {
  // Gated on market hours for three reasons, not one: there is nothing to
  // enter outside them, the sample buffer would fill with stale prices, and
  // every tick would spend Upstox requests -- which is what pushes the app
  // into Upstox's 1015 rate limit -- for no possible benefit.
  if (!getMarketStatus().isOpen) return;
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  // Checked BEFORE any upstream call. With no ntfy topic saved there is
  // nowhere to send a push, so fetching the data to build one would be pure
  // waste against the rate limit.
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  let buffers: TwentySampleBuffer = {};
  try {
    buffers = JSON.parse((await env.COMMODITY_KV.get(TWENTY_SAMPLES_KV_KEY)) ?? "{}") as TwentySampleBuffer;
  } catch {
    buffers = {};
  }

  let buffersChanged = false;

  for (const symbol of OPTION_SYMBOLS) {
    try {
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) continue;
      const fast = await getCandlesForTF(env, token, fut, "5");
      if ("error" in fast || fast.length === 0) continue;

      const optionsResult = await computeOptionsAnalytics(env, token, symbol as Symbol);
      const options = "error" in optionsResult ? undefined : optionsResult;

      // --- keep the momentum buffer -------------------------------------
      const atmRow = options && options.atmStrike !== null ? options.rows.find((r) => r.strike === options.atmStrike) : undefined;
      const strike = atmRow?.strike ?? null;
      const prev = buffers[symbol];
      const buf = prev && prev.strike === strike ? prev : { strike, ce: [], pe: [] };
      const ceLtp = atmRow?.call.ltp ?? null;
      const peLtp = atmRow?.put.ltp ?? null;
      if (typeof ceLtp === "number") buf.ce = [...buf.ce, ceLtp].slice(-TWENTY_MAX_SAMPLES);
      if (typeof peLtp === "number") buf.pe = [...buf.pe, peLtp].slice(-TWENTY_MAX_SAMPLES);
      buffers[symbol] = buf;
      buffersChanged = true;

      // --- the same engine the page runs --------------------------------
      const analysis = analyzeImmediate(fast, twentyMomentumPct(buf.ce), twentyMomentumPct(buf.pe));
      const candidates = scanForAiTwenty([{ symbol, analysis }]);
      if (candidates.length === 0) continue;
      const projection = projectPremium20(analysis, options);
      if (!projection) continue;

      const sig = twentySignature(symbol, projection.strike, projection.optSide, projection.entry);
      const sigKey = `notified:TWENTY20-${symbol}`;
      if ((await env.COMMODITY_KV.get(sigKey)) === sig) continue;
      await env.COMMODITY_KV.put(sigKey, sig);

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const lot = TWENTY_LOT_SIZE[symbol as keyof typeof TWENTY_LOT_SIZE] ?? 1;
      const t1 = projection.targets[0];
      await sendNtfyNotification(
        topic,
        `Ai20-20: ${displayName} ${projection.strike} ${projection.optSide}`,
        [
          `BUY ${displayName} ${projection.strike} ${projection.optSide}`,
          "",
          `Entry: Rs ${projection.entry}`,
          `Target 1: Rs ${t1}`,
          `Stop: Rs ${projection.stop}`,
          "",
          `About Rs ${Math.round((t1 - projection.entry) * lot)} per lot at Target 1.`,
          "",
          "Open the app and tap Can I Buy Now? before entering -- this call was",
          "sent the moment it fired, and price may have moved since.",
        ].join("\n")
      );
    } catch {
      // One symbol failing must never stop the other, and must never fail the
      // whole Cron run.
    }
  }

  if (buffersChanged) {
    // A single key for both symbols, written once per tick and only during
    // market hours -- roughly 175 writes a day rather than 576.
    await env.COMMODITY_KV.put(TWENTY_SAMPLES_KV_KEY, JSON.stringify(buffers), { expirationTtl: 24 * 60 * 60 });
  }
}

// Runs the exact same 3-engine comparison (AI Elite + Directional Gate +
// Kimi playbook -> pickBestCall) the frontend's Best Call page displays,
// entirely server-side so it can run on a schedule with nobody's browser
// open. Returns null the same way the frontend does when nothing currently
// qualifies -- never fabricates a pick just to have something to notify.
async function computeBestCallForSymbol(env: Env, token: string, symbol: Symbol): Promise<BestCallPick | null> {
  const fut = await getNearestFuture(token, symbol);
  if (!fut) return null;
  const commodity: "NG" | "CL" = symbol === "NATURALGAS" ? "NG" : "CL";

  const candlesByTf: Record<string, Candle[]> = {};
  for (const { tf } of CRON_TIMEFRAMES) {
    const c = await getCandlesForTF(env, token, fut, tf);
    candlesByTf[tf] = "error" in c ? [] : c;
  }
  const daily = await getCandlesForTF(env, token, fut, "1D");
  candlesByTf["1D"] = "error" in daily ? [] : daily;

  const optionsResult = await computeOptionsAnalytics(env, token, symbol);
  const options = "error" in optionsResult ? undefined : optionsResult;

  const analyses = CRON_TIMEFRAMES.map(({ tf, label }) =>
    analyzeTimeframe({ tf, label, candles: candlesByTf[tf], dailyCandles: candlesByTf["1D"], options, journalWinRate: null })
  );
  const eliteEntries = analyses.map((a) => ({ symbol, analysis: a, options }));
  const elite = findEliteSignal(eliteEntries);
  const elitePick = elite ? eliteToBestCallPick(elite) : null;

  const gatePicks: BestCallPick[] = [];
  for (const direction of ["bullish", "bearish"] as const) {
    for (const { tf, label } of CRON_TIMEFRAMES) {
      const evaluation = evaluateDirectionalGate(direction, candlesByTf[tf], candlesByTf[CRON_TREND_TF[tf]] ?? []);
      if (evaluation.status !== "qualified") continue;
      const p = gateToBestCallPick(evaluation, direction, label, options);
      if (p) gatePicks.push(p);
    }
  }

  const kimiTimeframes = CRON_TIMEFRAMES.map(({ tf, label }) => ({ tf, label, candles: candlesByTf[tf] }));
  const kimiResults = scanAllSetups(commodity, kimiTimeframes);
  const kimiPicks = kimiResults.map((r) => kimiToBestCallPick(r, commodity, options)).filter((p): p is BestCallPick => p !== null);

  const allPicks = [...(elitePick ? [elitePick] : []), ...gatePicks, ...kimiPicks];
  return pickBestCall(allPicks);
}

// Only notifies when the pick actually CHANGES (tracked via a per-symbol
// "last notified" signature in KV) -- otherwise the same still-running call
// would re-notify every single Cron tick.
export async function runBestCallNotificationCheck(env: Env): Promise<void> {
  // Market hours only. This computes a full best-call pick for both symbols --
  // candles plus an option chain each -- and it ran every five minutes around
  // the clock, weekends included. With MCX shut the inputs cannot change, so
  // every one of those runs was wasted Upstox calls, and one landing just
  // after a cache expired could push a stale "Best Call" at 3 AM.
  if (!mcxSessionAt().isOpen) return;
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  for (const symbol of OPTION_SYMBOLS) {
    try {
      const pick = await computeBestCallForSymbol(env, token, symbol as Symbol);
      if (!pick) continue;
      const lastSigKey = `notified:BEST-${symbol}`;
      const lastSig = await env.COMMODITY_KV.get(lastSigKey);
      const sig = bestCallSignature(pick);
      if (sig === lastSig) continue;
      await env.COMMODITY_KV.put(lastSigKey, sig);

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const title = `Best Call: ${displayName} ${pick.strike} ${pick.optSide}`;
      const body = [
        `BUY ${displayName} ${pick.strike} ${pick.optSide}`,
        "",
        `Entry: Rs ${pick.entry}`,
        `Targets: ${pick.targets.join(" / ")}`,
        `Stop: Rs ${pick.stop}`,
        "",
        `Source: ${pick.source} (${Math.round(pick.confidence)}% confidence)`,
      ].join("\n");
      await sendNtfyNotification(topic, title, body);
    } catch {
      // best-effort -- one symbol failing shouldn't block the other
    }
  }
}
