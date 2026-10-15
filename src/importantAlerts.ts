// "Very important" pushes beyond trade calls -- only things that change what
// the trader should do right now, each at most once:
//   * EIA report in ~30 minutes (crude Wednesday, gas storage Thursday): price
//     can jump either way at the release -> no new entries, tighten stops.
//   * Live data not working at the open (Upstox login expired or failing):
//     every card is blank until it is fixed.
// Trade Card calls (TRADE / target / stop / day end) are pushed by
// tradeCardTracker; expiry by expiryAlerts; big headlines by newsFlash.

import { cachePut, type Env, type Symbol } from "./env";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";
import { getCandlesForTF } from "./signals";
import { getNearestFuture } from "./upstox";
import { mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { scheduledEvents, type ScheduledEvent } from "../frontend/src/utils/timeProfileEngine";

/** Pushed when the release is this many minutes away (one FAST tick lands in the window). */
const EVENT_WARN_FROM = 25;
const EVENT_WARN_TO = 35;
/** Live-data check window after the 09:00 open, IST minutes. */
const LOGIN_CHECK_FROM = 9 * 60 + 2;
const LOGIN_CHECK_TO = 9 * 60 + 45;

export function eventWarningText(e: Pick<ScheduledEvent, "name" | "affects" | "istLabel" | "minutesAway">): { title: string; body: string } {
  const market = e.affects === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
  return {
    title: `⏰ ${e.name} in ${e.minutesAway} min`,
    body: [
      `${e.name} at ${e.istLabel} IST -- ${market} can jump sharply EITHER way at the release.`,
      "",
      "- No new entries until 15 min after the release.",
      "- Open trade in profit: book some, or move the stop to cost.",
      "- The Trade Card shows AVOID - EVENT RISK until it is out.",
    ].join("\n"),
  };
}

export function loginWarningText(reason: string): { title: string; body: string } {
  return {
    title: "🔑 Live data NOT working -- log in to Upstox",
    body: [
      "MCX is open but the app cannot load live prices, so every card is blank or old.",
      `Reason: ${reason}`,
      "",
      "Open the app -> log in to Upstox again. Don't trade off old cards.",
    ].join("\n"),
  };
}

export async function runImportantAlerts(env: Env): Promise<string[]> {
  const report: string[] = [];
  const now = Date.now();
  const s = mcxSessionAt(now);
  if (!s.isOpen) return ["MCX closed -- no important alerts."];
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return ["No ntfy topic saved."];
  const send = async (markerKey: string, msg: { title: string; body: string }, priority: "urgent" | "high") => {
    if (await env.COMMODITY_KV.get(markerKey)) return false;
    // No marker saved -> no push, or it would repeat every 5 minutes.
    if (!(await cachePut(env.COMMODITY_KV, markerKey, "1", { expirationTtl: 2 * 86_400 }))) return false;
    const r = await sendNtfyNotification(topic, msg.title, msg.body, priority, { token: env.NTFY_TOKEN });
    return r.ok;
  };

  // 1. EIA release coming up.
  for (const e of scheduledEvents(now)) {
    if (e.minutesAway < EVENT_WARN_FROM || e.minutesAway > EVENT_WARN_TO) continue;
    const ok = await send(`notified:EVENT-${e.id}-${e.atIso.slice(0, 10)}`, eventWarningText(e), "high");
    report.push(`${e.name}: ${ok ? "warning pushed" : "already warned (or push failed)"}.`);
  }

  // 2. Live data at the open: try the real thing, not just "is a token saved".
  if (s.minutes >= LOGIN_CHECK_FROM && s.minutes <= LOGIN_CHECK_TO) {
    let reason: string | null = null;
    const token = await env.COMMODITY_KV.get("access_token");
    if (!token) reason = "not logged in to Upstox today (the login expires every night).";
    else {
      try {
        const fut = await getNearestFuture(token, "CRUDEOIL" as Symbol);
        const c = fut ? await getCandlesForTF(env, token, fut, "5") : { error: "no Crude Oil futures contract found" };
        if ("error" in c) reason = String(c.error);
      } catch (e: any) {
        reason = e?.message ?? "Upstox request failed";
      }
    }
    if (reason) {
      const ok = await send(`notified:LOGIN-${s.date}`, loginWarningText(reason), "urgent");
      report.push(`live data failing (${reason}) -- ${ok ? "pushed" : "already pushed"}.`);
    } else report.push("live data OK at the open.");
  }
  return report;
}
