// Raw numbers for the Price + OI read (frontend/src/utils/oiBuildup.ts does
// the classifying, so this stays a cheap fetch-and-pick).
//
// For the nearest two futures: the price and OI now (today's last 1-minute
// bar), the previous session's close and OI (daily candles), and the bar an
// hour ago. When the market is shut there are no bars for today, and the last
// two daily candles are compared instead. OI of 0 means Upstox sent none, and
// is passed on as null -- the read then says "no OI data" rather than guess.

import type { OiBuildupResponse, OiContractSnapshot } from "../frontend/src/utils/oiBuildup";
import type { Candle, Env, FutureInfo, Symbol } from "./env";
import { getHistoricalCandles, getIntradayCandles, getUpcomingFutures } from "./upstox";

const oiOf = (c: Candle | undefined) => (c && c.oi > 0 ? c.oi : null);
const HOUR_MS = 60 * 60 * 1000;

async function snapshot(env: Env, token: string, fut: FutureInfo): Promise<OiContractSnapshot> {
  const [daily, today] = await Promise.all([
    getHistoricalCandles(env, token, fut.instrument_key).catch(() => null),
    getIntradayCandles(token, fut.instrument_key).catch(() => null),
  ]);
  const base = { tradingSymbol: fut.trading_symbol, expiry: fut.expiry.slice(0, 10) };
  const days = daily ?? [];

  if (today && today.length) {
    const last = today[today.length - 1];
    const todayDate = last.date.slice(0, 10);
    let prev: Candle | undefined;
    for (let i = days.length - 1; i >= 0; i--) if (days[i].date.slice(0, 10) < todayDate) { prev = days[i]; break; }
    const cutoff = new Date(last.date).getTime() - HOUR_MS;
    let hourBar: Candle | undefined;
    for (let i = today.length - 1; i >= 0; i--) if (new Date(today[i].date).getTime() <= cutoff) { hourBar = today[i]; break; }
    return {
      ...base,
      price: last.close, oi: oiOf(last), asOf: last.date,
      prevClose: prev?.close ?? null, prevOi: oiOf(prev), prevDate: prev?.date.slice(0, 10) ?? null,
      session: "live",
      hourAgo: hourBar ? { price: hourBar.close, oi: oiOf(hourBar), at: hourBar.date } : null,
    };
  }

  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  return {
    ...base,
    price: last?.close ?? null, oi: oiOf(last), asOf: last?.date ?? null,
    prevClose: prev?.close ?? null, prevOi: oiOf(prev), prevDate: prev?.date.slice(0, 10) ?? null,
    session: "last",
    hourAgo: null,
  };
}

export async function computeOiBuildup(env: Env, token: string, symbol: Symbol): Promise<OiBuildupResponse> {
  try {
    const futs = await getUpcomingFutures(token, symbol, 2);
    if (!futs.length) return { symbol, contracts: [], error: "No futures contract found" };
    return { symbol, contracts: await Promise.all(futs.map((f) => snapshot(env, token, f))) };
  } catch (e: any) {
    return { symbol, contracts: [], error: e?.message ?? "Could not load futures OI" };
  }
}
