// Price history for the Ai20-20 rules lab (run in GitHub Actions only).
// Every source is cut to MCX hours (9:00 AM IST to the close: 11:30 PM while
// the US is on summer time, 11:55 PM in US winter) and scaled to rupees at a
// fixed USDINR, because MCX Crude / NG track NYMEX tick for tick. Nothing
// here writes prices anywhere; the lab prints aggregates only.

import { createRequire } from "node:module";
import { mcxCloseMinutes } from "../frontend/src/utils/mcxSession";
import type { LabSym } from "../frontend/src/utils/twentyLab";
import type { Candle } from "../frontend/src/types";

export const SITE = process.env.SITE ?? "https://kumar-signals.akumalla-kumar-sbh.workers.dev";
export const USDINR = 88;

/** True when a candle starting at `ms` falls inside MCX hours. `dstClose`: use the real US-winter 23:55 close (else always 23:30). */
export function inMcxHours(ms: number, dstClose = true): boolean {
  const ist = new Date(ms + 5.5 * 3600_000);
  const wd = ist.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const min = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const close = dstClose ? mcxCloseMinutes(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate()) : 23 * 60 + 30;
  return min >= 9 * 60 && min < close;
}

export async function yahoo(ticker: string, dstClose = false): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=60d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const j: any = await res.json();
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((x) => typeof x !== "number" || !Number.isFinite(x))) continue;
    const ms = ts[i] * 1000;
    if (!inMcxHours(ms, dstClose)) continue;
    out.push({ date: new Date(ms).toISOString(), open: o * USDINR, high: h * USDINR, low: l * USDINR, close: c * USDINR, volume: q.volume?.[i] ?? 0 });
  }
  return out;
}

export async function mcx(symbol: LabSym): Promise<Candle[] | string> {
  try {
    // /api/history-5m answers while MCX is shut too; /api/candles only while it is open.
    for (const path of [`/api/history-5m?symbol=${symbol}`, `/api/candles?symbol=${symbol}&tf=5`]) {
      const res = await fetch(`${SITE}${path}`, { headers: { Accept: "application/json" } });
      const j: any = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (!j.error && Array.isArray(j.candles) && j.candles.length >= 100) return j.candles as Candle[];
      if (path.startsWith("/api/candles")) return String(j.error ?? `HTTP ${res.status}`);
    }
    return "no data";
  } catch (e) {
    return `${String(e)} ${String((e as any)?.cause?.message ?? "")}`;
  }
}

/**
 * Years of 5-minute candles from Dukascopy's free history (CFDs that follow
 * the front NYMEX contract; volume is their own tick volume). Needs the
 * dukascopy-node package installed in $DUKA_DIR (the workflow does this).
 */
export async function dukascopy(instrument: "lightcmdusd" | "gascmdusd", fromIso: string, toIso: string, log: (s: string) => void = () => {}): Promise<Candle[]> {
  const dir = process.env.DUKA_DIR;
  if (!dir) throw new Error("DUKA_DIR is not set");
  const req = createRequire(`${dir}/package.json`);
  const { getHistoricalRates } = req("dukascopy-node");
  const out: Candle[] = [];
  const end = new Date(toIso);
  let start = new Date(fromIso);
  while (start < end) {
    const stop = new Date(Math.min(end.getTime(), Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 6, 1)));
    const t0 = Date.now();
    const rows: any[] = await getHistoricalRates({
      instrument,
      dates: { from: start, to: stop },
      timeframe: "m5",
      format: "json",
      priceType: "bid",
      volumes: true,
      batchSize: 10,
      pauseBetweenBatchesMs: 600,
      retryCount: 4,
      pauseBetweenRetriesMs: 2000,
      failAfterRetryCount: false,
      // Downloaded days are kept between lab runs (an Actions cache, never committed).
      ...(process.env.DUKA_CACHE ? { useCache: true, cacheFolderPath: process.env.DUKA_CACHE } : {}),
    });
    let kept = 0;
    for (const r of rows ?? []) {
      const ms = Number(r.timestamp);
      if (![r.open, r.high, r.low, r.close].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
      if (!inMcxHours(ms)) continue;
      out.push({ date: new Date(ms).toISOString(), open: r.open * USDINR, high: r.high * USDINR, low: r.low * USDINR, close: r.close * USDINR, volume: Number(r.volume) || 0 });
      kept++;
    }
    log(`${instrument} ${start.toISOString().slice(0, 10)}..${stop.toISOString().slice(0, 10)}: ${rows?.length ?? 0} rows, ${kept} in MCX hours, ${Math.round((Date.now() - t0) / 1000)}s`);
    start = stop;
  }
  return out;
}
