// Ai20-20 v3 for one market: the live read on finished 5-minute candles, the
// exact order ticket, the call log (page and server write the same entries),
// the trader's lots from their own plan, and the setups' record re-measured
// on ~20 days of real MCX candles (in a background worker).
//
// Light on a phone: candles every 15 s (a call only changes on a finished
// candle), option prices every 8 s only while a call runs, nothing live for a
// market with no live setups and nothing open.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useHistory5m, useNewsTrade, useOptionsAnalytics } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { useMyPlan } from "../store/myPlanStore";
import { advanceOpenEntry, liveLtpFor, MAX_HISTORY } from "../utils/tradeLogCore";
import { expiryBlock } from "../utils/twentyV2";
import { liveCtx, openV3Entry, readV3, v3Guard, type V3Record } from "../utils/twentyV3/live";
import { ENGINE_V3, type EngineDef } from "../utils/twentyV3/engines";
import { liquidityGate, newsGate, type GateResult } from "../utils/twentyV3/gates";
import { newsPulseFor } from "../utils/newsPulse";
import { buildTicket, pickStrike, type StrikeChoice } from "../utils/twentyV3/ticket";
import { dayBudget, lotsFor } from "../utils/twentyV3/riskPlan";
import { measureV3Async } from "../utils/twentyV3/recordClient";
import { LAB_LOT, type LabSym } from "../utils/twentyLab";

/** Earlier rule sets' logs: a call still running there keeps being managed until it closes. */
export const olderKeys = (sym: LabSym) => ENGINE_V3.olderKeys(sym);

const CANDLE_MS = 15_000;
const LIVE_PRICE_MS = 8_000;

export function useTwentyV3(sym: LabSym, def: EngineDef = ENGINE_V3) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);
  const plan = useMyPlan((s) => s.plan);
  const key = def.key(sym);
  const log = useMemo(() => tradeLogs[key] ?? [], [tradeLogs, key]);
  const older = def.olderKeys(sym).flatMap((k) => tradeLogs[k] ?? []);
  const openNow = [...log, ...older].some((e) => !e.closed);
  const on = def.active[sym].length > 0;
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

  const qc = useQueryClient();
  useEffect(() => {
    if (!openNow) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ["options-analytics", sym] }), LIVE_PRICE_MS);
    return () => clearInterval(id);
  }, [openNow, qc, sym]);

  // Re-read every 15 s so a just-finished candle counts before the feed refreshes.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => (candles.length ? liveCtx(candles, Date.now()) : null), [candles, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useMemo(() => readV3(candles, sym, Date.now(), ctx, def), [ctx, sym]);
  const choice: StrikeChoice | null = useMemo(() => (read.state === "call" && read.entry ? pickStrike(options, read.entry.side) : null), [read, options]);
  const ticket = useMemo(() => (read.entry && choice ? buildTicket(read.entry, choice, sym) : null), [read, choice, sym]);

  // Live-only checks (Ai-Super Fast): a liquid strike and the news on the call's side.
  const newsQ = useNewsTrade();
  const news = useMemo(() => {
    const d = newsQ.data;
    if (!def.gates.news || !d?.news?.available) return null;
    const eia = sym === "CRUDEOIL" ? (d.eia?.crude ?? null) : (d.eia?.ngStorage ?? null);
    return newsPulseFor(sym, d.news.articles ?? [], eia, d.news.builtAt ?? d.fetchedAt ?? null, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsQ.data, sym, tick]);
  const gates: GateResult[] = useMemo(() => {
    if (read.state !== "call" || !read.entry) return [];
    const out: GateResult[] = [];
    if (def.gates.liquidity) out.push(liquidityGate(options, choice, read.entry.side));
    if (def.gates.news) out.push(newsGate(news, read.entry.side));
    return out;
  }, [read, options, choice, news, def]);
  const gatesOk = gates.every((g) => g.ok);

  // Open the call (the SAME entry the server writes) or move the running one along.
  useEffect(() => {
    const now = Date.now();
    const history = useAppStore.getState().tradeLogs[key] ?? [];
    const last = history[history.length - 1];
    if (last && !last.closed) {
      const next = advanceOpenEntry(last, liveLtpFor(options, last.strike, last.optSide), now);
      if (next !== last) setTradeLog(key, [...history.slice(0, -1), next]);
      return;
    }
    if (read.state !== "call" || !ticket || !gatesOk || expiryBlock(options, now)) return;
    const entry = openV3Entry(ticket, read, def);
    if (history.some((e) => e.id === entry.id)) return;
    if (!v3Guard(history, ticket.side, sym, now).ok) return;
    setTradeLog(key, [...history, entry].slice(-MAX_HISTORY));
  }, [read, ticket, gatesOk, options, key, sym, setTradeLog]);

  // Calls made under earlier rules keep moving until they close.
  useEffect(() => {
    for (const k of def.olderKeys(sym)) {
      const history = useAppStore.getState().tradeLogs[k] ?? [];
      const last = history[history.length - 1];
      if (!last || last.closed) continue;
      const next = advanceOpenEntry(last, liveLtpFor(options, last.strike, last.optSide), Date.now());
      if (next !== last) setTradeLog(k, [...history.slice(0, -1), next]);
    }
  }, [options, sym, setTradeLog]);

  const hist = useHistory5m(sym);
  const [record, setRecord] = useState<V3Record | null>(null);
  const [recordState, setRecordState] = useState<"loading" | "ready" | "error" | "off">(on ? "loading" : "off");
  useEffect(() => {
    if (!on) return;
    const c = hist.data?.candles;
    if (!c) {
      if (hist.data?.error || hist.isError) setRecordState("error");
      return;
    }
    let alive = true;
    measureV3Async(c, sym, def).then((r) => {
      if (!alive) return;
      setRecord(r);
      setRecordState(r ? "ready" : "error");
    });
    return () => {
      alive = false;
    };
  }, [hist.data, hist.isError, sym, on]);

  const now = Date.now();
  const guard = v3Guard(log, read.entry?.side ?? null, sym, now);
  const running = log.length && !log[log.length - 1].closed ? log[log.length - 1] : null;
  const riskPerLot = ticket ? ticket.riskPerLot : running ? Math.round((running.entry - running.stop) * LAB_LOT[sym]) : 0;
  const premiumPerLot = ticket ? ticket.premiumPerLot : running ? Math.round(running.entry * LAB_LOT[sym]) : 0;
  const lots = lotsFor(plan, riskPerLot, premiumPerLot);
  const budget = dayBudget(plan, log, LAB_LOT[sym], Math.max(1, lots.lots), now);
  return {
    def,
    gates,
    gatesOk,
    news,
    sym,
    on,
    candles,
    ctx,
    options,
    loading: candlesQ.isLoading || optionsQ.isLoading,
    liveDataUnavailable: live && (!!optionsQ.error || !!optionsQ.data?.error),
    read,
    ticket,
    running,
    log,
    older,
    guard,
    lots,
    budget,
    plan,
    expiry: on ? expiryBlock(options) : null,
    record,
    recordState,
    key,
  };
}

export type TwentyV3State = ReturnType<typeof useTwentyV3>;
