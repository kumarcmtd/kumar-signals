// Ai20-20 v2 for one market: the live read on finished 5-minute candles, the
// option plan, the call log, and the rules' record re-measured on ~15 days of
// real MCX candles. See utils/twentyV2.ts for the rules and why.

import { useEffect, useMemo, useState } from "react";
import { useHistory5m } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { advanceOpenEntry, liveLtpFor, MAX_HISTORY } from "../utils/tradeLogCore";
import { measureV2, openV2Entry, planV2, readV2, v2Guard, v2Key, type V2Record } from "../utils/twentyV2";
import type { LabSym } from "../utils/twentyLab";
import { useImmediateSuite } from "./useImmediateSuite";

/** The old rules' log, kept so a call made before v2 can still be managed and its record read. */
export const legacyKey = (sym: LabSym) => `TWENTY20-${sym}-LIVE`;

export function useTwentyV2(sym: LabSym) {
  const suite = useImmediateSuite(sym);
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);
  const key = v2Key(sym);

  // Re-read at least every 15 s so a candle that has just finished counts
  // even if the candle feed has not refreshed yet.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => readV2(suite.candles, sym, Date.now()), [suite.candles, sym, tick]);
  const plan = useMemo(() => planV2(read, suite.options, sym), [read, suite.options, sym]);

  // Open the call (the SAME entry the server writes for it -- id from the
  // signal candle), or move the running one along with the live premium.
  useEffect(() => {
    const now = Date.now();
    const history = useAppStore.getState().tradeLogs[key] ?? [];
    const last = history[history.length - 1];
    if (last && !last.closed) {
      const next = advanceOpenEntry(last, liveLtpFor(suite.options, last.strike, last.optSide), now);
      if (next !== last) setTradeLog(key, [...history.slice(0, -1), next]);
      return;
    }
    if (read.state !== "call" || !plan) return;
    const entry = openV2Entry(plan, read);
    if (history.some((e) => e.id === entry.id)) return;
    if (!v2Guard(history, read.side, now).ok) return;
    setTradeLog(key, [...history, entry].slice(-MAX_HISTORY));
  }, [read, plan, suite.options, key, setTradeLog]);

  // A call from the old rules that is still running keeps moving too.
  useEffect(() => {
    const k = legacyKey(sym);
    const history = useAppStore.getState().tradeLogs[k] ?? [];
    const last = history[history.length - 1];
    if (!last || last.closed) return;
    const next = advanceOpenEntry(last, liveLtpFor(suite.options, last.strike, last.optSide), Date.now());
    if (next !== last) setTradeLog(k, [...history.slice(0, -1), next]);
  }, [suite.options, sym, setTradeLog]);

  // The record: worked out in the browser after the page has drawn (scoring
  // every candle takes a moment), from the same candles the server uses.
  const hist = useHistory5m(sym);
  const [record, setRecord] = useState<V2Record | null>(null);
  const [recordState, setRecordState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const c = hist.data?.candles;
    if (!c) {
      if (hist.data?.error || hist.isError) setRecordState("error");
      return;
    }
    const id = setTimeout(() => {
      const r = measureV2(c, sym);
      setRecord(r);
      setRecordState(r ? "ready" : "error");
    }, 60);
    return () => clearTimeout(id);
  }, [hist.data, hist.isError, sym]);

  const log = tradeLogs[key] ?? [];
  const legacy = tradeLogs[legacyKey(sym)] ?? [];
  const guard = v2Guard(log, read.side, Date.now());
  return { ...suite, read, plan, log, legacy, guard, record, recordState, key };
}

export type TwentyV2State = ReturnType<typeof useTwentyV2>;
