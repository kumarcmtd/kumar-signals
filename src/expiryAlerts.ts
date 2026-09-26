// Options expiry alerts, 2 days out, sent once per (symbol, expiry, day).

import { istParts, mcxSessionAt } from "../frontend/src/utils/mcxSession";
import { type Env, isRateLimit, OPTION_SYMBOLS } from "./env";
import { NTFY_TOPIC_KV_KEY, sendNtfyNotification } from "./notify";
import { resolveOptionExpiryCandidates } from "./optionChain";
import { getNearestFuture } from "./upstox";

// ---- Options expiry alerts (Crude Oil / Natural Gas, 2 days out) ----
// MCX options near expiry lose liquidity and bleed theta fast -- a trade
// that looked fine a week out can become hard to exit at a fair price in
// the final couple of sessions. This surfaces a plain warning once the
// REAL listed option expiry (not the future's own, later, expiry -- see
// resolveOptionExpiryCandidates above) is 2 days away or closer, so open
// positions get closed or rolled in time rather than discovered stuck.
interface ExpiryAlert {
  symbol: "CRUDEOIL" | "NATURALGAS";
  displayName: string;
  expiry: string;
  daysLeft: number;
  message: string;
}

const EXPIRY_ALERT_DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

// Calendar-day difference (UTC midnight to UTC midnight), not a raw
// millisecond division -- that would round differently depending on what
// time of day "now" happens to be, flipping the reported daysLeft back and
// forth across a boundary within the same calendar day.
// "Today" is the IST calendar date. Using the UTC date meant that between
// midnight and 05:30 IST -- when UTC is still on yesterday -- expiry day read
// as "expires tomorrow".
function daysUntil(expiry: string): number {
  const e = new Date(expiry);
  const expiryMidnight = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const t = istParts();
  const todayMidnight = Date.UTC(t.y, t.m - 1, t.d);
  return Math.round((expiryMidnight - todayMidnight) / 86_400_000);
}

function expiryAlertMessage(displayName: string, daysLeft: number): string {
  if (daysLeft <= 0) {
    return `${displayName} options expire TODAY. Close or roll any open trade before end of session -- liquidity and spreads worsen fast into expiry.`;
  }
  if (daysLeft === 1) {
    return `${displayName} options expire tomorrow. Close or roll open trades soon -- theta decay accelerates sharply in the last couple of sessions.`;
  }
  return `${displayName} options expire in ${daysLeft} days. Start planning to close or roll open trades -- theta decay accelerates sharply into expiry.`;
}

// Best-effort per symbol, same pattern as computeBestCallForSymbol -- one
// symbol's lookup failing (e.g. a transient Upstox error) shouldn't block
// the other from still being reported.
export async function computeExpiryAlerts(token: string): Promise<ExpiryAlert[]> {
  const out: ExpiryAlert[] = [];
  for (const symbol of OPTION_SYMBOLS) {
    try {
      const fut = await getNearestFuture(token, symbol);
      if (!fut) continue;
      const candidates = await resolveOptionExpiryCandidates(token, fut);
      const expiry = candidates[0];
      if (!expiry) continue;
      const daysLeft = daysUntil(expiry);
      if (daysLeft < 0 || daysLeft > 2) continue;
      const displayName = EXPIRY_ALERT_DISPLAY_NAME[symbol] ?? symbol;
      out.push({ symbol: symbol as ExpiryAlert["symbol"], displayName, expiry, daysLeft, message: expiryAlertMessage(displayName, daysLeft) });
    } catch (e) {
      // best-effort -- one symbol failing shouldn't block the other. Except a
      // rate limit: both symbols share one Upstox token and one limit, so the
      // next symbol is guaranteed to fail too and only extends it.
      if (isRateLimit(e)) break;
    }
  }
  return out;
}

// Re-notifies once per distinct (symbol, expiry, daysLeft) combination --
// so the user gets pinged at 2 days out, again at 1 day, again on expiry
// day itself, but not every 5 minutes in between.
/** Expiry warnings may go out from this IST time on trading days, ahead of the open. */
const EXPIRY_ALERT_FROM_MIN = 7 * 60;

export async function runExpiryAlertCheck(env: Env): Promise<void> {
  // Trading days from 07:00 IST until the close. Early enough that "expires
  // TODAY" is read before 09:00; there is nothing to warn about overnight or
  // at weekends, when this used to run anyway.
  const s = mcxSessionAt();
  if (!(s.weekday >= 1 && s.weekday <= 5) || s.minutes < EXPIRY_ALERT_FROM_MIN || s.minutes >= s.closeMin) return;
  const token = await env.COMMODITY_KV.get("access_token");
  if (!token) return;
  const topic = await env.COMMODITY_KV.get(NTFY_TOPIC_KV_KEY);
  if (!topic) return;

  try {
    const alerts = await computeExpiryAlerts(token);
    for (const alert of alerts) {
      const key = `notified:EXPIRY-${alert.symbol}-${alert.expiry}-${alert.daysLeft}`;
      const already = await env.COMMODITY_KV.get(key);
      if (already) continue;
      await env.COMMODITY_KV.put(key, "1", { expirationTtl: 7 * 86_400 });

      const daysLabel = alert.daysLeft <= 0 ? "TODAY" : alert.daysLeft === 1 ? "1 day" : `${alert.daysLeft} days`;
      const title = `⏳ ${alert.displayName} options expiry in ${daysLabel}`;
      await sendNtfyNotification(topic, title, alert.message);
    }
  } catch {
    // best-effort -- a failed check just means no alert fires this tick
  }
}
