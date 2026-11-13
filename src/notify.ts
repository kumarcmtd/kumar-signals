// ntfy push notifications: Best Call and Ai20-20 background checks.

import { expiryBlock, measureV2, openV2Entry, planV2, readV2, v2Guard, v2Key, v2PushText, v2Window, V2_MARKETS } from "../frontend/src/utils/twentyV2";
import type { LabSym } from "../frontend/src/utils/twentyLab";
import type { OptionsAnalytics } from "../frontend/src/types";
import { type BestCallPick, eliteToBestCallPick, gateToBestCallPick, kimiToBestCallPick, pickBestCall } from "../frontend/src/utils/bestCallSelector";
import { evaluateDirectionalGate } from "../frontend/src/utils/directionalGateEngine";
import { findEliteSignal } from "../frontend/src/utils/eliteSignal";
import { scanAllSetups } from "../frontend/src/utils/kimiScanner";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { evaluateBuyDecision } from "../frontend/src/utils/buyDecisionEngine";
import { tradeVerdict } from "../frontend/src/utils/tradeVerdict";
import { newsPulseFor } from "../frontend/src/utils/newsPulse";
import { fetchEiaData } from "./eiaCalendar";
import { fetchEnergyNews } from "./news";
import { daysToExpiry } from "../frontend/src/utils/oiBuildup";
import { scheduledEvents } from "../frontend/src/utils/timeProfileEngine";
import { analyzeTimeframe } from "../frontend/src/utils/timeframeEngine";
import { cachePut, type Candle, type Env, type FutureInfo, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { getCandlesForTF } from "./signals";
import { getNearestFuture, getPriorDayBars } from "./upstox";
import { pushTradeLogs, readTradeLogKey } from "./tradeLogStore";

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

// ---- Ai20-20 background calls (ntfy.sh) ----
//
// The trader is at work or away when calls fire, so Ai20-20 runs here on the
// Cron with no browser open, on the SAME pure v2 engine the page renders
// (frontend/src/utils/twentyV2.ts): a pushed call and an on-screen call can
// never disagree. When it finds a call it also OPENS it in the trade log, so
// every pushed call is tracked -- target, stop and day-end close -- even if
// the app is never opened. The page writes the identical entry (same id, from
// the signal candle) when it is open, so the two never double up.

const IST_OFFSET_MS = 5.5 * 3600_000;

/** These v2 rules re-measured on the prior days' real MCX candles; once a day, cached. */
async function twentyRecord(env: Env, token: string, instrumentKey: string, sym: LabSym, now: number): Promise<{ trades: number; avgRs: number | null; days: number; caution: boolean } | null> {
  const day = new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
  const kvKey = `twenty2:rec:${sym}:${day}`;
  const cached = await env.COMMODITY_KV.get(kvKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // rebuild below
    }
  }
  const bars = await getPriorDayBars(env, token, instrumentKey, 20, 5);
  if (!bars) return null;
  const m = measureV2(bars, sym, false);
  if (!m) return null;
  const out = { trades: m.v2.trades, avgRs: m.v2.avgRs, days: m.days, caution: m.caution };
  await cachePut(env.COMMODITY_KV, kvKey, JSON.stringify(out), { expirationTtl: 2 * 86_400 });
  return out;
}

/** What the Trade Card says about this side right now, as one line for the push (null if it cannot load). */
async function twentyCardLine(env: Env, token: string, fut: FutureInfo, symbol: Symbol, fast: Candle[], options: OptionsAnalytics | undefined, side: "CE" | "PE", now: number): Promise<string | null> {
  const [c15, c60, c240] = await Promise.all(["15", "60", "240"].map((tf) => getCandlesForTF(env, token, fut, tf)));
  if ("error" in c15 || "error" in c60 || "error" in c240) return null;
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
  if (!verify) return null;
  const [newsFeed, eiaData] = await Promise.all([fetchEnergyNews(env).catch(() => null), fetchEiaData(env).catch(() => null)]);
  const sym = symbol === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL";
  const eia = sym === "CRUDEOIL" ? (eiaData?.crude ?? null) : (eiaData?.ngStorage ?? null);
  const news = newsFeed?.available ? newsPulseFor(sym, newsFeed.articles, eia, newsFeed.builtAt ?? null, now) : null;
  const card = tradeVerdict({ result: verify, c5: fast, c15, news, now, marketOpen: true });
  return card.action === `TRADE_${side}` ? `agrees (${card.headline})` : `${card.headline} -- ${card.reason}`;
}

/** The MATCHED push format, kept for the Settings test button. */
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
  pulseTitle?: string | null;
  newsText?: string | null;
  cardText?: string | null;
}): { title: string; body: string } {
  return {
    title: `MATCHED: ${p.displayName} ${p.strike} ${p.optSide}`,
    body: [
      `BUY ${p.displayName} ${p.strike} ${p.optSide}`,
      `Ai20-20 call + AI Verify Pro BUY ${p.optSide} agree (${p.strength}/94${p.since ? `, confirmed since ${p.since}` : ""}).`,
      p.liveHeadline ? `Right now: ${p.liveHeadline}` : "",
      p.pulseTitle ? `5-min trend: ${p.pulseTitle}` : "",
      p.newsText ? `News: ${p.newsText}` : "",
      p.cardText ? `Trade Card: ${p.cardText}` : "",
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
 * One Cron tick of Ai20-20 (v2). Returns one plain-English line per market
 * saying what it found, so the "Check now" button can show why a push did or
 * did not go. The Cron ignores the report.
 */
export async function runTwentyTwentyNotificationCheck(env: Env, now: number = Date.now()): Promise<string[]> {
  // Market hours first: nothing to enter outside them, and every tick would
  // spend Upstox requests -- what pushes the app into the 1015 rate limit.
  if (!getMarketStatus().isOpen) return ["MCX is closed -- Ai20-20 only runs while the market is open."];
  const win = v2Window(now);
  if (!win.open) return [`Ai20-20 calls only ${win.label} (10:30 AM - 1:15 PM New York) -- outside that window now.`];
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return ["Not logged in to Upstox today -- no live data to check."];
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  const report: string[] = [];

  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol as LabSym;
    const name = symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
    const say = (t: string) => report.push(`${name}: ${t}`);
    if (!V2_MARKETS[sym]) {
      say("no Ai20-20 calls on this market -- 5-minute calls lost money on gas in every rule set tested.");
      continue;
    }
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
      const read = readV2(fast, sym, now);
      if (read.state !== "call" || !read.barEnd) {
        say(read.headline);
        continue;
      }
      // One look per signal candle (the "check now" button can run mid-candle too).
      const barKey = `notified:TWENTY2-${symbol}`;
      if ((await env.COMMODITY_KV.get(barKey)) === String(read.barEnd)) {
        say(`${read.side} call on this candle -- already handled.`);
        continue;
      }
      const key = v2Key(sym);
      const guard = v2Guard(await readTradeLogKey(env, key), read.side, now);
      if (!guard.ok) {
        say(`${read.side} call skipped: ${guard.reason}`);
        await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const optionsResult = await computeOptionsAnalytics(env, token, symbol as Symbol);
      const options = "error" in optionsResult ? undefined : optionsResult;
      const onExpiry = expiryBlock(options, now);
      if (onExpiry) {
        say(`${read.side} call skipped: ${onExpiry}`);
        await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const plan = planV2(read, options, sym);
      if (!plan) {
        say(`${read.side} call, but no live option premium to price it -- nothing recorded.`);
        continue;
      }
      // Marker first: past the KV write limit it cannot be saved, and acting
      // anyway would record and push the same call again on the next tick.
      if (!(await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 }))) {
        say("call found, but the already-handled marker could not be saved -- skipped so it cannot repeat.");
        continue;
      }
      await pushTradeLogs(env, { [key]: [openV2Entry(plan, read)] });
      say(`${plan.strike} ${plan.optSide} @ Rs ${plan.entry} -- call recorded in the trade log.`);
      if (!topic) {
        say("no ntfy topic saved -- recorded but not pushed.");
        continue;
      }
      const [record, cardLine] = await Promise.all([
        twentyRecord(env, token, fut.instrument_key, sym, now).catch(() => null),
        twentyCardLine(env, token, fut, symbol as Symbol, fast, options, plan.optSide, now).catch(() => null),
      ]);
      const msg = v2PushText({ displayName: name, plan, read, record, cardLine, caution: record?.caution ?? false });
      const sent = await sendNtfyNotification(topic, msg.title, msg.body, "urgent", { token: env.NTFY_TOKEN });
      say(sent.ok ? "pushed." : `push failed: ${sent.error ?? "unknown error"}.`);
    } catch (e: any) {
      // One market failing must never stop the other, or fail the Cron run.
      say(`check failed (${e?.message ?? "error"}).`);
    }
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
