// Ai20-20 v2 for one market: the live read on finished 5-minute candles, the
// option plan, the call log, and the rules' record re-measured on ~15 days of
// real MCX candles. See utils/twentyV2.ts for the rules and why.
//
// Kept light so the page never freezes on a phone:
//   - candles refresh on the app's normal 15 s cadence (calls only change on
//     a FINISHED 5-minute candle, so faster gains nothing)
//   - option prices refresh every 8 s only while a call is running (live P&L
//     and "Can I buy now?"); a market with calls off and nothing running
//     fetches nothing live at all
//   - the 15-day record runs in a background worker, cached on the phone

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useHistory5m, useOptionsAnalytics } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { advanceOpenEntry, liveLtpFor, MAX_HISTORY } from "../utils/tradeLogCore";
import { expiryBlock, openV2Entry, planV2, readV2, v2Guard, v2Key, V2_MARKETS, type V2Record } from "../utils/twentyV2";
import { measureV2Async } from "../utils/twentyRecordClient";
import type { LabSym } from "../utils/twentyLab";

/** The old rules' log, kept so a call made before v2 can still be managed and its record read. */
export const legacyKey = (sym: LabSym) => `TWENTY20-${sym}-LIVE`;

const CANDLE_MS = 15_000;
const LIVE_PRICE_MS = 8_000;

export function useTwentyV2(sym: LabSym) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);
  const key = v2Key(sym);
  const log = tradeLogs[key] ?? [];
  const legacy = tradeLogs[legacyKey(sym)] ?? [];
  const openNow = [...log, ...legacy].some((e) => !e.closed);
  const on = V2_MARKETS[sym];
  const live = on || openNow;

  const candlesQ = useQuery({
    queryKey: ["candles", sym, "5"],
    queryFn: () => api.candles(sym, "5"),
    staleTime: 10_000,
    enabled: live,
    refetchInterval: live ? CANDLE_MS : false,
  });
  const optionsQ = useOptionsAnalytics(sym, live);
  const options = optionsQ.data && !optionsQ.data.error ? optionsQ.data : undefined;
  const candles = useMemo(() => (candlesQ.data && "candles" in candlesQ.data ? (candlesQ.data.candles ?? []) : []), [candlesQ.data]);

  // Faster option prices only while a call is running.
  const qc = useQueryClient();
  useEffect(() => {
    if (!openNow) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ["options-analytics", sym] }), LIVE_PRICE_MS);
    return () => clearInterval(id);
  }, [openNow, qc, sym]);

  // Re-read at least every 15 s so a candle that has just finished counts
  // even before the candle feed refreshes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => readV2(candles, sym, Date.now()), [candles, sym, tick]);
  const plan = useMemo(() => planV2(read, options, sym), [read, options, sym]);

  // Open the call (the SAME entry the server writes for it -- id from the
  // signal candle), or move the running one along with the live premium.
  useEffect(() => {
    const now = Date.now();
    const history = useAppStore.getState().tradeLogs[key] ?? [];
    const last = history[history.length - 1];
    if (last && !last.closed) {
      const next = advanceOpenEntry(last, liveLtpFor(options, last.strike, last.optSide), now);
      if (next !== last) setTradeLog(key, [...history.slice(0, -1), next]);
      return;
    }
    if (read.state !== "call" || !plan) return;
    if (expiryBlock(options, now)) return;
    const entry = openV2Entry(plan, read);
    if (history.some((e) => e.id === entry.id)) return;
    if (!v2Guard(history, read.side, now).ok) return;
    setTradeLog(key, [...history, entry].slice(-MAX_HISTORY));
  }, [read, plan, options, key, setTradeLog]);

  // A call from the old rules that is still running keeps moving too.
  useEffect(() => {
    const k = legacyKey(sym);
    const history = useAppStore.getState().tradeLogs[k] ?? [];
    const last = history[history.length - 1];
    if (!last || last.closed) return;
    const next = advanceOpenEntry(last, liveLtpFor(options, last.strike, last.optSide), Date.now());
    if (next !== last) setTradeLog(k, [...history.slice(0, -1), next]);
  }, [options, sym, setTradeLog]);

  // The record: in a background worker, cached per market until new candles arrive.
  const hist = useHistory5m(sym);
  const [record, setRecord] = useState<V2Record | null>(null);
  const [recordState, setRecordState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const c = hist.data?.candles;
    if (!c) {
      if (hist.data?.error || hist.isError) setRecordState("error");
      return;
    }
    let alive = true;
    measureV2Async(c, sym).then((r) => {
      if (!alive) return;
      setRecord(r);
      setRecordState(r ? "ready" : "error");
    });
    return () => {
      alive = false;
    };
  }, [hist.data, hist.isError, sym]);

  const guard = v2Guard(log, read.side, Date.now());
  const expiry = on ? expiryBlock(options) : null;
  return {
    expiry,
    candles,
    options,
    loading: candlesQ.isLoading || optionsQ.isLoading,
    liveDataUnavailable: live && (!!optionsQ.error || !!optionsQ.data?.error),
    read,
    plan,
    log,
    legacy,
    guard,
    record,
    recordState,
    key,
  };
}

export type TwentyV2State = ReturnType<typeof useTwentyV2>;
