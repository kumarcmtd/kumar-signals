// ntfy push notifications: Best Call and Ai20-20 background checks.

import { analyzeImmediate, LOT_SIZE as TWENTY_LOT_SIZE, projectPremium20, scanForAiTwenty } from "../frontend/src/utils/aiTwentyTwentyEngine";
import { type BestCallPick, eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall } from "../frontend/src/utils/bestCallSelector";
import { evaluateDirectionalGate } from "../frontend/src/utils/directionalGateEngine";
import { findEliteSignal } from "../frontend/src/utils/eliteSignal";
import { scanAllSetups } from "../frontend/src/utils/kimiScanner";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { evaluateBuyDecision } from "../frontend/src/utils/buyDecisionEngine";
import { callMatch } from "../frontend/src/utils/callMatch";
import { liveMomentum } from "../frontend/src/utils/liveMomentum";
import { daysToExpiry } from "../frontend/src/utils/oiBuildup";
import { scheduledEvents } from "../frontend/src/utils/timeProfileEngine";
import { analyzeTimeframe } from "../frontend/src/utils/timeframeEngine";
import { cachePut, type Candle, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
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

// Side + engine, not strike: while one call stays live, price walking the
// at-the-money strike from 310 to 315 is the same call, not a new alert.
function bestCallSignature(pick: BestCallPick): string {
  return `${pick.optSide}-${pick.source}`;
}

// ntfy priorities: "urgent" (5) is the max-priority channel -- the one the
// ntfy app can ring through Do Not Disturb and keep ringing until dismissed
// ("insistent"). Trade calls use it: with the phone locked the page cannot
// sound anything, so this push IS the alert. Informational pushes (expiry
// reminders) stay at "high".
export type NtfyPriority = "urgent" | "high" | "default";

/** Waits before each retry of a failed push (ms). Exported so tests can pass zeros. */
export const NTFY_RETRY_DELAYS_MS = [1_500, 4_000];

// A push is a trade alert: one brief hiccup at ntfy.sh (a 5xx such as
// Cloudflare's 522 "origin timed out", a 429, or a dropped connection) must
// not lose it. So it is retried twice with a short wait before giving up,
// and the final error says plainly whose side the problem is on.
export async function sendNtfyNotification(
  topic: string,
  title: string,
  body: string,
  priority: NtfyPriority = "high",
  opts: { token?: string; retryDelaysMs?: number[] } = {}
): Promise<{ ok: boolean; error?: string }> {
  const retryDelaysMs = opts.retryDelaysMs ?? NTFY_RETRY_DELAYS_MS;
  const headers: Record<string, string> = { Title: title, Priority: priority, Tags: priority === "urgent" ? "rotating_light,chart_with_upwards_trend" : "chart_with_upwards_trend" };
  // With an access token ntfy.sh rate-limits per account instead of per IP.
  // Cloudflare Workers send from IPs shared with countless other apps, which
  // ntfy.sh throttles (429) or drops (522) when anonymous.
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let last = "";
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelaysMs[attempt - 1]));
    try {
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: "POST",
        headers,
        body,
      });
      if (res.ok) return { ok: true };
      last = `HTTP ${res.status}`;
      // A 4xx other than rate-limiting is our request's fault -- retrying cannot help.
      if (res.status === 401 || res.status === 403) return { ok: false, error: `ntfy.sh refused the access token (${last}) -- check the NTFY_TOKEN secret in Cloudflare.` };
      if (res.status < 500 && res.status !== 429) return { ok: false, error: `ntfy.sh responded ${last}` };
    } catch (err: any) {
      last = err?.message ?? "request failed";
    }
  }
  const tries = retryDelaysMs.length + 1;
  if (!opts.token && (last === "HTTP 429" || last === "HTTP 522")) {
    return { ok: false, error: `ntfy.sh is limiting pushes from Cloudflare's shared servers (${last}, tried ${tries} times). Fix: add a free ntfy.sh access token as the NTFY_TOKEN secret in Cloudflare.` };
  }
  return { ok: false, error: `ntfy.sh is not responding right now (${last}, tried ${tries} times). This is on ntfy's side -- try again in a few minutes.` };
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
const TWENTY_MEM_FRESH_MS = 11 * 60 * 1000; // older than two ticks -> trust KV instead
// Paid plan: back up every tick, so a cold isolate never loses samples.
// (Free plan used 15 minutes to stay under 1,000 KV writes a day.)
const TWENTY_KV_BACKUP_MS = 0;
let twentyMem: { at: number; backedUpAt: number; buffers: TwentySampleBuffer } | null = null;

/** The MATCHED push, shared by the real alert and the test button so they look identical. */
export function matchedPushText(p: {
  displayName: string;
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  t1: number;
  stop: number;
  lot: number;
  strength: number;
  since: string | null;
  liveHeadline: string | null;
}): { title: string; body: string } {
  return {
    title: `MATCHED: ${p.displayName} ${p.strike} ${p.optSide}`,
    body: [
      `BUY ${p.displayName} ${p.strike} ${p.optSide}`,
      `Ai20-20 call + AI Verify Pro BUY ${p.optSide} agree (${p.strength}/94${p.since ? `, confirmed since ${p.since}` : ""}).`,
      p.liveHeadline ? `Right now: ${p.liveHeadline}` : "",
      "",
      `Entry: Rs ${p.entry}`,
      `Target 1: Rs ${p.t1}`,
      `Stop: Rs ${p.stop}`,
      "",
      `About Rs ${Math.round((p.t1 - p.entry) * p.lot)} per lot at Target 1.`,
      "",
      "Open the app and tap Can I Buy Now? before entering -- this call was",
      "sent the moment it fired, and price may have moved since.",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n"),
  };
}

/**
 * Returns one plain-English line per market saying what the check found, so
 * the "Check for MATCHED now" button can show why a push did or did not go.
 * The Cron ignores the report.
 */
export async function runTwentyTwentyNotificationCheck(env: Env): Promise<string[]> {
  const report: string[] = [];
  // Gated on market hours for three reasons, not one: there is nothing to
  // enter outside them, the sample buffer would fill with stale prices, and
  // every tick would spend Upstox requests -- which is what pushes the app
  // into Upstox's 1015 rate limit -- for no possible benefit.
  if (!getMarketStatus().isOpen) return ["MCX is closed -- the MATCHED check only runs while the market is open."];
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return ["Not logged in to Upstox today -- no live data to check."];
  // Checked BEFORE any upstream call. With no ntfy topic saved there is
  // nowhere to send a push, so fetching the data to build one would be pure
  // waste against the rate limit.
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return ["No ntfy topic saved -- there is nowhere to send a push."];

  // Memory first: this was a KV write every 5 minutes (~175 a day, a sixth
  // of the free plan's 1,000). Cron runs usually land on a warm isolate, so
  // the buffer lives in memory and KV only keeps a backup copy every
  // TWENTY_KV_BACKUP_MS. A cold isolate reloads that backup -- at worst a few
  // samples short, which the momentum read already tolerates.
  let buffers: TwentySampleBuffer = {};
  if (twentyMem && Date.now() - twentyMem.at < TWENTY_MEM_FRESH_MS) {
    buffers = twentyMem.buffers;
  } else {
    try {
      buffers = JSON.parse((await env.COMMODITY_KV.get(TWENTY_SAMPLES_KV_KEY)) ?? "{}") as TwentySampleBuffer;
    } catch {
      buffers = {};
    }
  }

  let buffersChanged = false;

  for (const symbol of OPTION_SYMBOLS) {
    const name = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
    const say = (t: string) => report.push(`${name}: ${t}`);
    try {
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) {
        say("no futures contract found.");
        continue;
      }
      const fast = await getCandlesForTF(env, token, fut, "5");
      if ("error" in fast || fast.length === 0) {
        say("no 5-minute candles yet.");
        continue;
      }

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
      if (candidates.length === 0) {
        say("no Ai20-20 call right now.");
        continue;
      }
      const projection = projectPremium20(analysis, options);
      if (!projection) {
        say("Ai20-20 leans one way but no option premium to price the call.");
        continue;
      }

      // Push ONLY when AI Verify Pro (closed 15m/1h/4h candles) has confirmed
      // the same side and the live candle is not already turning against it.
      // An unmatched Ai20-20 call alone fires too often to trade on.
      const now = Date.now();
      const [c15, c60, c240] = await Promise.all(["15", "60", "240"].map((tf) => getCandlesForTF(env, token, fut, tf)));
      if ("error" in c15 || "error" in c60 || "error" in c240) {
        say(`Ai20-20 ${projection.optSide} call, but the 15m/1h/4h candles did not load.`);
        continue;
      }
      const session = mcxSessionAt(now);
      const event = scheduledEvents(now).find((e) => e.affects === symbol);
      const verify = evaluateBuyDecision({
        c15,
        c60,
        c240,
        now,
        marketOpen: true,
        eia: event ? { minutesAway: event.minutesAway, minutesSince: 7 * 24 * 60 - event.minutesAway, label: event.name } : null,
        minutesToClose: session.isOpen ? session.closeMin - session.minutes : null,
        daysToOptionExpiry: options ? daysToExpiry(options.expiry, now) : null,
      });
      if (!verify) {
        say(`Ai20-20 ${projection.optSide} call, but not enough closed candles for AI Verify Pro.`);
        continue;
      }
      const live = liveMomentum(c15, fast, verify, now, true);
      const match = callMatch(verify, live, projection.optSide);
      if (!match.ok) {
        say(`Ai20-20 ${projection.strike} ${projection.optSide} -- not matched: ${match.text}.`);
        continue;
      }

      // One push per confirmed AI Verify setup -- not one per premium tick.
      const sig = `${twentySignature(symbol, projection.strike, projection.optSide, 0)}-${verify.since ?? verify.lastClosedAt ?? ""}`;
      const sigKey = `notified:MATCHED-${symbol}`;
      if ((await env.COMMODITY_KV.get(sigKey)) === sig) {
        say(`MATCHED ${projection.strike} ${projection.optSide} -- already pushed for this setup.`);
        continue;
      }
      // Only alert if the "already sent" marker was saved -- past the daily
      // KV write limit it cannot be, and alerting anyway would resend this
      // same call every five minutes.
      if (!(await cachePut(env.COMMODITY_KV, sigKey, sig))) {
        say("MATCHED, but the already-sent marker could not be saved, so no push (it would repeat).");
        continue;
      }

      const msg = matchedPushText({
        displayName: name,
        strike: projection.strike,
        optSide: projection.optSide,
        entry: projection.entry,
        t1: projection.targets[0],
        stop: projection.stop,
        lot: TWENTY_LOT_SIZE[symbol as keyof typeof TWENTY_LOT_SIZE] ?? 1,
        strength: verify.strength,
        since: verify.since,
        liveHeadline: live?.headline ?? null,
      });
      const sent = await sendNtfyNotification(topic, msg.title, msg.body, "urgent", { token: env.NTFY_TOKEN });
      say(sent.ok ? `MATCHED ${projection.strike} ${projection.optSide} -- push sent.` : `MATCHED, but the push failed: ${sent.error ?? "unknown error"}.`);
    } catch (e: any) {
      // One symbol failing must never stop the other, and must never fail the
      // whole Cron run.
      say(`check failed (${e?.message ?? "error"}).`);
    }
  }

  if (buffersChanged) {
    const now = Date.now();
    const lastBackup = twentyMem?.backedUpAt ?? 0;
    let backedUpAt = lastBackup;
    if (now - lastBackup >= TWENTY_KV_BACKUP_MS) {
      if (await cachePut(env.COMMODITY_KV, TWENTY_SAMPLES_KV_KEY, JSON.stringify(buffers), { expirationTtl: 24 * 60 * 60 })) backedUpAt = now;
    }
    twentyMem = { at: now, backedUpAt, buffers };
  }
  return report;
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
      const lastSigKey = `notified:BEST-${symbol}`;
      const lastSig = await env.COMMODITY_KV.get(lastSigKey);
      if (!pick) {
        // The call has ended: forget it, so the next one (even the same side)
        // is alerted as the new call it is.
        if (lastSig) await env.COMMODITY_KV.delete(lastSigKey).catch(() => undefined);
        continue;
      }
      const sig = bestCallSignature(pick);
      if (sig === lastSig) continue;
      if (!(await cachePut(env.COMMODITY_KV, lastSigKey, sig))) continue; // no marker, no alert (see above)

      const displayName = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
      const title = `Best Call: ${displayName} ${pick.strike} ${pick.optSide}`;
      const body = [
        `BUY ${displayName} ${pick.strike} ${pick.optSide}`,
        "",
        `Entry: Rs ${pick.entry}`,
        `Targets: ${pick.targets.join(" / ")}`,
        `Stop: Rs ${pick.stop}`,
        "",
        // Never above 94%: no call is ever that certain (the app-wide rule).
        `Source: ${pick.source} (${Math.min(94, Math.round(pick.confidence))}% of checks agree)`,
        "",
        "Open Capital Guard for your lot size before entering -- price may have moved.",
      ].join("\n");
      await sendNtfyNotification(topic, title, body, "urgent", { token: env.NTFY_TOKEN });
    } catch {
      // best-effort -- one symbol failing shouldn't block the other
    }
  }
}
