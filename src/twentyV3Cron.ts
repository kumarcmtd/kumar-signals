// Ai20-20 v3 on the server, so calls and every step reach the phone with the
// app closed:
//   runTwentyV3CallCheck (FAST, every 5 min): inside the call window, read the
//     live setups on finished 5-minute candles -- the same pure engine the page
//     runs -- and on a call write the SAME trade-log entry the page writes (id
//     from the signal candle), then push the exact order.
//   runTwentyV3StepCheck (TRADES, right after tradeLogCron advances calls
//     against live premiums): push each step the latest call has reached (T1,
//     T2, closed) exactly once, and a day summary after the window ends.

import { LAB_LOT, type LabSym } from "../frontend/src/utils/twentyLab";
import { expiryBlock } from "../frontend/src/utils/twentyV2";
import { callWindow } from "../frontend/src/utils/twentyV3/dayPlan";
import { measureV3, openV3Entry, readV3, v3Guard, v3Key, V3_LIVE } from "../frontend/src/utils/twentyV3/live";
import { stepsOf, v3CallPushText, v3DaySummaryText, v3StepPushText } from "../frontend/src/utils/twentyV3/push";
import { buildTicket, pickStrike } from "../frontend/src/utils/twentyV3/ticket";
import { cachePut, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { getCandlesForTF } from "./signals";
import { pushTradeLogs, readTradeLogKey } from "./tradeLogStore";
import { getNearestFuture, getPriorDayBars } from "./upstox";

const IST_MS = 5.5 * 3600_000;
const NAME: Record<LabSym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const istDate = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);

/** The live setups re-measured on the prior days' real MCX candles; once a day, cached. */
async function v3Record(env: Env, token: string, instrumentKey: string, sym: LabSym, now: number): Promise<{ trades: number; avgRs: number | null } | null> {
  const kvKey = `twenty3:rec:${sym}:${V3_LIVE[sym].join("+")}:${istDate(now)}`;
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
  const m = measureV3(bars, sym);
  if (!m) return null;
  const out = { trades: m.together.trades, avgRs: m.together.avgRs };
  await cachePut(env.COMMODITY_KV, kvKey, JSON.stringify(out), { expirationTtl: 2 * 86_400 });
  return out;
}

export async function runTwentyV3CallCheck(env: Env, now: number = Date.now()): Promise<string[]> {
  if (!getMarketStatus().isOpen) return ["MCX is closed -- Ai20-20 only runs while the market is open."];
  const report: string[] = [];
  let token: string | null | undefined;
  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol as LabSym;
    const say = (t: string) => report.push(`${NAME[sym]}: ${t}`);
    const setups = V3_LIVE[sym];
    if (!setups.length) {
      say("no v3 setup passed the lab for this market -- no calls.");
      continue;
    }
    const w = callWindow(setups, now);
    if (!w?.open) {
      say(`calls only ${w?.label ?? "on weekdays"} -- outside that window now.`);
      continue;
    }
    try {
      token ??= await env.COMMODITY_KV.get("access_token");
      if (!token) return [...report, "Not logged in to Upstox today -- no live data to check."];
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) {
        say("no futures contract found.");
        continue;
      }
      const candles = await getCandlesForTF(env, token, fut, "5");
      if ("error" in candles || candles.length === 0) {
        say("no 5-minute candles yet.");
        continue;
      }
      const read = readV3(candles, sym, now);
      if (read.state !== "call" || !read.entry || !read.barEnd) {
        say(read.headline);
        continue;
      }
      const barKey = `notified:TWENTY3-${symbol}`;
      if ((await env.COMMODITY_KV.get(barKey)) === String(read.barEnd)) {
        say(`${read.entry.side} call on this candle -- already handled.`);
        continue;
      }
      const key = v3Key(sym);
      const guard = v3Guard(await readTradeLogKey(env, key), read.entry.side, sym, now);
      if (!guard.ok) {
        say(`${read.entry.side} call skipped: ${guard.reason}`);
        await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const optionsResult = await computeOptionsAnalytics(env, token, symbol as Symbol);
      const options = "error" in optionsResult ? undefined : optionsResult;
      const onExpiry = expiryBlock(options, now);
      if (onExpiry) {
        say(`${read.entry.side} call skipped: ${onExpiry}`);
        await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const choice = pickStrike(options, read.entry.side, now);
      if (!choice) {
        say(`${read.entry.side} call, but no live option premium to price it -- nothing recorded.`);
        continue;
      }
      const ticket = buildTicket(read.entry, choice, sym);
      // Marker first: if it cannot be saved, acting anyway would repeat the call next tick.
      if (!(await cachePut(env.COMMODITY_KV, barKey, String(read.barEnd), { expirationTtl: 86_400 }))) {
        say("call found, but the already-handled marker could not be saved -- skipped so it cannot repeat.");
        continue;
      }
      await pushTradeLogs(env, { [key]: [openV3Entry(ticket, read)] });
      say(`${ticket.strike} ${ticket.side} @ Rs ${ticket.entry} (${read.entry.setup}) -- call recorded.`);
      const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
      if (!topic) {
        say("no ntfy topic saved -- recorded but not pushed.");
        continue;
      }
      const record = await v3Record(env, token, fut.instrument_key, sym, now).catch(() => null);
      const msg = v3CallPushText({ displayName: NAME[sym], t: ticket, setup: read.entry.setup, regime: read.regime?.text ?? null, record });
      const sent = await sendNtfyNotification(topic, msg.title, msg.body, "urgent", { token: env.NTFY_TOKEN });
      say(sent.ok ? "pushed." : `push failed: ${sent.error ?? "unknown error"}.`);
    } catch (e: any) {
      say(`check failed (${e?.message ?? "error"}).`);
    }
  }
  return report;
}

/** Push every step the latest v3 call has reached, once each; then the day summary after the window. */
export async function runTwentyV3StepCheck(env: Env, now: number = Date.now()): Promise<string[]> {
  const report: string[] = [];
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return ["no ntfy topic saved."];
  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol as LabSym;
    if (!V3_LIVE[sym].length) continue;
    const log = await readTradeLogKey(env, v3Key(sym));
    const last = log[log.length - 1];
    if (last && now - last.openedAt < 20 * 3600_000) {
      for (const step of stepsOf(last)) {
        const mark = `notified:TWENTY3-STEP:${last.id}:${step}`;
        if (await env.COMMODITY_KV.get(mark)) continue;
        if (!(await cachePut(env.COMMODITY_KV, mark, "1", { expirationTtl: 2 * 86_400 }))) continue;
        const msg = v3StepPushText(NAME[sym], last, step, LAB_LOT[sym]);
        const sent = await sendNtfyNotification(topic, msg.title, msg.body, msg.priority, { token: env.NTFY_TOKEN });
        report.push(`${NAME[sym]}: ${step} ${sent.ok ? "pushed" : "push failed"}.`);
      }
    }
    // Day summary: once on a weekday, after today's window has closed and nothing is still running.
    // (callWindow moves on to the next weekday once today's window is over.)
    const w = callWindow(V3_LIVE[sym], now);
    const wd = new Date(now + IST_MS).getUTCDay();
    const windowOver = wd >= 1 && wd <= 5 && (!w || istDate(w.from) !== istDate(now));
    const today = log.filter((e) => istDate(e.openedAt) === istDate(now));
    if (!windowOver || today.some((e) => !e.closed)) continue;
    const sumKey = `notified:TWENTY3-DAY:${sym}:${istDate(now)}`;
    if (await env.COMMODITY_KV.get(sumKey)) continue;
    if (!(await cachePut(env.COMMODITY_KV, sumKey, "1", { expirationTtl: 2 * 86_400 }))) continue;
    const msg = v3DaySummaryText(NAME[sym], today, LAB_LOT[sym]);
    const sent = await sendNtfyNotification(topic, msg.title, msg.body, "default", { token: env.NTFY_TOKEN });
    report.push(`${NAME[sym]}: day summary ${sent.ok ? "pushed" : "push failed"}.`);
  }
  return report;
}
