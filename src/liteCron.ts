// Ai Lite on the server, so calls and their steps reach the phone with the
// app closed:
//   runLiteCallCheck (FAST, every 5 min): read the three rules on the latest
//     finished 15-minute candle -- the same pure engine the page runs -- and on
//     a call write the SAME trade-log entry the page writes (id from the signal
//     candle), then push the order with its Rs 2,000 target and Rs 1,000 stop.
//   runLiteStepCheck (TRADES, right after tradeLogCron moves calls along
//     against live premiums): push each step reached (T1, T2, closed) once.

import { LITE, LITE_LOT, type LiteSym } from "../frontend/src/utils/lite/engine";
import { liteGuard, liteKey, openLiteEntry, readLite } from "../frontend/src/utils/lite/live";
import { daysToExpiry } from "../frontend/src/utils/oiBuildup";
import { stepsOf, v3StepPushText } from "../frontend/src/utils/twentyV3/push";
import { pickStrike } from "../frontend/src/utils/twentyV3/ticket";
import { cachePut, type Env, getMarketStatus, OPTION_SYMBOLS, type Symbol } from "./env";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";
import { computeOptionsAnalytics } from "./optionsAnalytics";
import { getCandlesForTF } from "./signals";
import { pushTradeLogs, readTradeLogKey } from "./tradeLogStore";
import { getNearestFuture } from "./upstox";

const NAME: Record<LiteSym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const SHORT: Record<LiteSym, string> = { CRUDEOIL: "Crude", NATURALGAS: "NG" };

export async function runLiteCallCheck(env: Env, now: number = Date.now()): Promise<string[]> {
  if (!getMarketStatus().isOpen) return ["MCX is closed -- Ai Lite only calls while the market is open."];
  const report: string[] = [];
  let token: string | null | undefined;
  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol as LiteSym;
    const say = (t: string) => report.push(`Ai Lite ${NAME[sym]}: ${t}`);
    try {
      token ??= await env.COMMODITY_KV.get("access_token");
      if (!token) return [...report, "Not logged in to Upstox today -- no live data to check."];
      const fut = await getNearestFuture(token, symbol as Symbol);
      if (!fut) {
        say("no futures contract found.");
        continue;
      }
      const candles = await getCandlesForTF(env, token, fut, "15");
      if ("error" in candles || candles.length === 0) {
        say("no 15-minute candles yet.");
        continue;
      }
      const read = readLite(candles, now);
      const side = read.state === "call" ? read.signal?.side : null;
      if (!side || !read.barEnd) {
        say(read.state === "call" ? "no side." : `${read.state} -- ${read.signal?.checks.map((c) => `${c.label} ${c.ok ? "ok" : "no"}`).join(", ") ?? "no read"}.`);
        continue;
      }
      const mark = `notified:LITE-${symbol}`;
      if ((await env.COMMODITY_KV.get(mark)) === String(read.barEnd)) {
        say(`${side} call on this candle -- already handled.`);
        continue;
      }
      const key = liteKey(sym);
      const guard = liteGuard(await readTradeLogKey(env, key), side, sym, now);
      if (!guard.ok) {
        say(`${side} call skipped: ${guard.reason}`);
        await cachePut(env.COMMODITY_KV, mark, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const optionsResult = await computeOptionsAnalytics(env, token, symbol as Symbol);
      const options = "error" in optionsResult ? undefined : optionsResult;
      const dte = options?.expiry ? daysToExpiry(options.expiry, now) : null;
      if (dte !== null && dte <= 0) {
        say(`${side} call skipped: option expires today.`);
        await cachePut(env.COMMODITY_KV, mark, String(read.barEnd), { expirationTtl: 86_400 });
        continue;
      }
      const choice = pickStrike(options, side, now);
      if (!choice) {
        say(`${side} call, but no live option premium to price it -- nothing recorded.`);
        continue;
      }
      // Marker first: if it cannot be saved, acting anyway would repeat the call next tick.
      if (!(await cachePut(env.COMMODITY_KV, mark, String(read.barEnd), { expirationTtl: 86_400 }))) {
        say("call found, but the already-handled marker could not be saved -- skipped so it cannot repeat.");
        continue;
      }
      const entry = openLiteEntry(choice, side, sym, read);
      await pushTradeLogs(env, { [key]: [entry] });
      say(`${entry.strike} ${side} @ Rs ${entry.entry} -- call recorded.`);
      const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
      if (!topic) {
        say("no ntfy topic saved -- recorded but not pushed.");
        continue;
      }
      const kind = read.signal?.kind === "breakout" ? "Breakout" : "Dip-and-turn";
      const title = `🍃 Ai Lite: BUY ${SHORT[sym]} ${entry.strike} ${side} @ Rs ${entry.entry}`;
      const body = [
        `${kind} with the ${side === "CE" ? "up" : "down"}trend on the 15-minute chart.`,
        `Target Rs ${entry.targets[2]} (+Rs ${LITE.targetRs.toLocaleString("en-IN")}/lot) · Stop Rs ${entry.stop} (-Rs ${LITE.stopRs.toLocaleString("en-IN")}/lot)`,
        `At Rs ${entry.targets[0]} (+Rs ${LITE.t1Rs.toLocaleString("en-IN")}) move the stop to entry; at Rs ${entry.targets[1]} lock +Rs ${LITE.t1Rs.toLocaleString("en-IN")}.`,
        `${choice.why}`,
      ].join("\n");
      const sent = await sendNtfyNotification(topic, title, body, "urgent", { token: env.NTFY_TOKEN });
      say(sent.ok ? "pushed." : `push failed: ${sent.error ?? "unknown error"}.`);
    } catch (e: any) {
      say(`check failed (${e?.message ?? "error"}).`);
    }
  }
  return report;
}

/** Push every step the latest Ai Lite call has reached (T1, T2, closed), once each. */
export async function runLiteStepCheck(env: Env, now: number = Date.now()): Promise<string[]> {
  const report: string[] = [];
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return ["no ntfy topic saved."];
  for (const symbol of OPTION_SYMBOLS) {
    const sym = symbol as LiteSym;
    const log = await readTradeLogKey(env, liteKey(sym));
    const last = log[log.length - 1];
    if (!last || now - last.openedAt > 20 * 3600_000) continue;
    for (const step of stepsOf(last)) {
      const mark = `notified:LITE-STEP:${last.id}:${step}`;
      if (await env.COMMODITY_KV.get(mark)) continue;
      if (!(await cachePut(env.COMMODITY_KV, mark, "1", { expirationTtl: 2 * 86_400 }))) continue;
      const msg = v3StepPushText(NAME[sym], last, step, LITE_LOT[sym], "Ai Lite");
      const sent = await sendNtfyNotification(topic, msg.title, msg.body, msg.priority, { token: env.NTFY_TOKEN });
      report.push(`Ai Lite ${NAME[sym]}: ${step} ${sent.ok ? "pushed" : "push failed"}.`);
    }
  }
  return report;
}
