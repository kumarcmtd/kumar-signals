import { useMemo, useState } from "react";
import { Target, TrendingUp, TrendingDown, Info, X, ChevronRight, ChevronDown, CandlestickChart, BellRing } from "lucide-react";
import { useMarketStatus, useSignal } from "../api/hooks";
import { useTwentyV2 } from "../hooks/useTwentyV2";
import { effectiveStopFor } from "../hooks/useTradeLog";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { verifiedEntryIds } from "../utils/dedupeTradeLog";
import { tickMarks, fmtWhen, DetailRow, CallChart, PriceScale, ProfitEstimate } from "../components/CallCardKit";
import { ExpiryAlertBanner } from "../components/ExpiryAlertBanner";
import { TwentyCallCard } from "../components/twenty/TwentyCallCard";
import { TwentyEdgePanel } from "../components/twenty/TwentyEdgePanel";
import { LAB_LOT } from "../utils/twentyLab";
import { v2Window } from "../utils/twentyV2";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import type { Candle } from "../types";

// Ai20-20 v2. The page shows what the measured rules say now for each market,
// the running call, and how the rules did on recent real candles. The rules
// themselves and the evidence behind them live in utils/twentyV2.ts.

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const PREFIX = "TWENTY20-";

// Keys are "TWENTY20-<SYMBOL>-<LIVE|V2>"; the symbol is one plain word.
function parseKey(key: string): { symbol: TradableSymbol; v2: boolean } {
  const parts = key.split("-");
  return { symbol: parts[1] as TradableSymbol, v2: parts[2] === "V2" };
}

const rs = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

function StatTile({ label, value, gradient }: { label: string; value: string; gradient: string }) {
  return (
    <div className="rounded-2xl p-2.5 text-center text-white shadow-sm" style={{ background: gradient }}>
      <p className="text-[9px] font-bold uppercase opacity-85">{label}</p>
      <p className="text-[14px] font-black leading-tight">{value}</p>
    </div>
  );
}

function CallHistoryRow({ symbol, entry, verified, v2, onOpen }: { symbol: TradableSymbol; entry: TradeLogEntry; verified: boolean; v2: boolean; onOpen: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? (exit - entry.entry) * LAB_LOT[symbol] : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "#059669" : pnl !== null && pnl < 0 ? "#E11D48" : "#B45309";
  const effStop = effectiveStopFor(entry);
  return (
    <button onClick={onOpen} className="w-full text-left rounded-xl border px-3 py-2.5 active:bg-slate-50" style={{ borderColor: verified ? "#E2E8F0" : "#FCA5A5", opacity: verified ? 1 : 0.6 }}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate text-slate-700">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}{" "}
            <span className={`ml-1 text-[9px] font-black px-1.5 py-0.5 rounded-full ${v2 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{v2 ? "v2" : "old rules"}</span>
          </p>
          <p className="text-[10px] text-slate-400">
            Called {fmtWhen(entry.openedAt)} at ₹{entry.entry}
            {entry.closed && entry.closedAt !== null && <> · Closed {fmtWhen(entry.closedAt)} at ₹{exit}</>}
          </p>
          {!verified && <span className="inline-block mt-1 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">Duplicate — not counted</span>}
        </div>
        <div className="text-right shrink-0 flex items-center gap-1">
          <div>
            <p className="text-xs font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </p>
            {pnl !== null && <p className="text-[10px] font-bold text-slate-500">{rs(pnl)}/lot</p>}
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-400">
        {entry.targets.map((t, i) => (
          <span key={i} className={entry.targetsHit[i] ? "text-emerald-600 font-semibold" : ""}>
            {tickMarks(entry.targetTouches?.[i] ?? (entry.targetsHit[i] ? 1 : 0))} T{i + 1} ₹{t}
          </span>
        ))}
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="opacity-60"> (was ₹{entry.stop})</span>}
        </span>
      </div>
    </button>
  );
}

function CallDetailModal({ symbol, entry, candles, candlesLoading, onClose }: { symbol: TradableSymbol; entry: TradeLogEntry; candles: Candle[]; candlesLoading: boolean; onClose: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const lot = LAB_LOT[symbol];
  const pnl = exit !== null ? (exit - entry.entry) * lot : null;
  const effStop = effectiveStopFor(entry);
  const Bias = entry.optSide === "CE" ? TrendingUp : TrendingDown;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black flex items-center gap-2 text-slate-800">
            <Bias size={20} style={{ color: entry.optSide === "CE" ? "#059669" : "#E11D48" }} />
            {DISPLAY_NAME[symbol]} {entry.strike} {entry.optSide}
          </p>
          <button onClick={onClose} className="p-2 rounded-full bg-slate-100 shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="rounded-2xl p-3.5 my-3 bg-slate-50">
          <p className="text-lg font-black" style={{ color: pnl === null ? "#B45309" : pnl > 0 ? "#059669" : pnl < 0 ? "#E11D48" : "#B45309" }}>
            {entry.closed ? entry.status.replace(/_/g, " ") : "Running"}
          </p>
          {pnl !== null && <p className="text-sm font-bold text-slate-500">{rs(pnl)} per lot</p>}
        </div>
        {entry.meta?.reasons?.length ? (
          <div className="mb-3 space-y-1">
            <p className="text-[10px] font-black uppercase text-slate-400">Why it was called</p>
            {entry.meta.reasons.map((r) => (
              <p key={r} className="text-[11px] text-slate-600">
                ✓ {r}
              </p>
            ))}
          </div>
        ) : null}
        <DetailRow label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
        {entry.closed && entry.closedAt !== null && <DetailRow label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
        {entry.targets.map((t, i) => (
          <DetailRow key={i} label={`Target ${i + 1}`} value={`₹${t}  ${tickMarks(entry.targetTouches?.[i] ?? (entry.targetsHit[i] ? 1 : 0))}`} valueColor={entry.targetsHit[i] ? "#059669" : undefined} />
        ))}
        <DetailRow label="Stop Loss" value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`} valueColor="#E11D48" />
        <div className="mt-4 -mx-5">
          <PriceScale entry={entry} current={entry.closed ? exit : null} />
          <ProfitEstimate trade={entry} current={entry.closed ? exit : null} lotSize={lot} />
        </div>
        <div className="mt-4">
          <p className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
            <CandlestickChart size={13} /> Chart
          </p>
          <CallChart candles={candles} entry={entry} loading={candlesLoading} errorReason={null} />
        </div>
      </div>
    </div>
  );
}

function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function AiTwentyTwenty() {
  const { data: market } = useMarketStatus();
  const [detail, setDetail] = useState<{ symbol: TradableSymbol; entry: TradeLogEntry } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const crude = useTwentyV2("CRUDEOIL");
  const gas = useTwentyV2("NATURALGAS");
  const board: Record<TradableSymbol, typeof crude> = { CRUDEOIL: crude, NATURALGAS: gas };
  const { data: crudeSignal } = useSignal("CRUDEOIL");
  const { data: gasSignal } = useSignal("NATURALGAS");
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  // Re-worked out whenever the live read refreshes (every 15 s).
  const win = useMemo(() => v2Window(Date.now()), [crude.read]);
  const now = Date.now();

  const twentyLogs = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith(PREFIX)) out[k] = v;
    return out;
  }, [tradeLogs]);
  const verifiedIds = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(twentyLogs)) out[k] = verifiedEntryIds(v);
    return out;
  }, [twentyLogs]);

  // The live record of real v2 calls, in Rs per lot.
  const v2Live = useMemo(() => {
    let closed = 0;
    let t1 = 0;
    let wins = 0;
    let net = 0;
    for (const [k, v] of Object.entries(twentyLogs)) {
      const { symbol, v2 } = parseKey(k);
      if (!v2) continue;
      for (const e of v) {
        if (!e.closed || !verifiedIds[k]?.has(e.id)) continue;
        const pnl = (exitPriceFor(e) - e.entry) * LAB_LOT[symbol];
        closed++;
        net += pnl;
        if (e.targetsHit[0]) t1++;
        if (pnl > 0) wins++;
      }
    }
    return { closed, t1, wins, net };
  }, [twentyLogs, verifiedIds]);
  const oldPerf = useMemo(() => {
    const old: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(twentyLogs)) if (!parseKey(k).v2) old[k] = v.filter((e) => verifiedIds[k]?.has(e.id));
    return computePerformanceStats(flattenClosedTrades(old));
  }, [twentyLogs, verifiedIds]);
  const allCalls = useMemo(() => {
    const out: { key: string; symbol: TradableSymbol; v2: boolean; entry: TradeLogEntry; verified: boolean }[] = [];
    for (const [k, v] of Object.entries(twentyLogs)) {
      const { symbol, v2 } = parseKey(k);
      for (const entry of v) out.push({ key: k, symbol, v2, entry, verified: verifiedIds[k]?.has(entry.id) ?? true });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [twentyLogs, verifiedIds]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#ECFDF5,#F0F9FF 40%,#F8FAFC)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <Target size={24} className="text-emerald-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent">Ai20-20</h1>
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-600 text-white">v2 · measured</span>
        </div>
        <p className="text-[11.5px] text-slate-600 px-3 leading-snug">
          Crude only, about one call a day, in the US session. Every call is on a finished 5-minute candle and must pass 4 checks. Calls reach your phone even with the app closed, and are tracked to target, stop or day end.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "MCX open" : "MCX closed") : "…"}
        </p>
      </section>

      <section className="rounded-2xl px-3 py-2.5 flex items-center gap-2.5 shadow-sm" style={{ background: win.open ? "linear-gradient(135deg,#059669,#10B981)" : "linear-gradient(135deg,#1E293B,#334155)" }}>
        <BellRing size={18} className="text-white shrink-0" />
        <div className="flex-1">
          <p className="text-[12.5px] font-black text-white">{win.open ? "Calls window OPEN now" : "Calls window closed"}</p>
          <p className="text-[10.5px] text-white/85">
            {win.label} · 10:00 AM – 1:15 PM New York
            {win.open ? ` · closes in ${countdown(win.closesAt - now)}` : win.opensAt ? ` · opens in ${countdown(win.opensAt - now)}` : ""}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Calls today" value={String(crude.guard.callsToday)} gradient="linear-gradient(135deg,#0EA5E9,#06B6D4)" />
        <StatTile label="Stops today" value={`${crude.guard.stopsToday} / 2`} gradient="linear-gradient(135deg,#F43F5E,#FB7185)" />
        <StatTile label="v2 live record" value={v2Live.closed ? rs(v2Live.net) : "new"} gradient="linear-gradient(135deg,#10B981,#059669)" />
      </div>

      <ExpiryAlertBanner />

      <TwentyCallCard sym="CRUDEOIL" s={crude} expiry={crudeSignal?.expiry} />
      <TwentyCallCard sym="NATURALGAS" s={gas} expiry={gasSignal?.expiry} />

      <TwentyEdgePanel crude={{ record: crude.record, state: crude.recordState }} gas={{ record: gas.record, state: gas.recordState }} />

      <div className="rounded-3xl bg-white shadow-md p-4 space-y-2">
        <p className="text-xs font-black text-slate-700">v2 live record — real calls since v2 started</p>
        {v2Live.closed === 0 ? (
          <p className="text-[11px] text-slate-500">No v2 call has closed yet. Each one is added here with its result in rupees per lot.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="text-[9px] text-slate-400 font-bold">CLOSED</p>
              <p className="text-sm font-black text-slate-700">{v2Live.closed}</p>
            </div>
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="text-[9px] text-slate-400 font-bold">T1 HIT</p>
              <p className="text-sm font-black text-slate-700">{Math.round((v2Live.t1 / v2Live.closed) * 100)}%</p>
            </div>
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="text-[9px] text-slate-400 font-bold">NET / LOT</p>
              <p className="text-sm font-black" style={{ color: v2Live.net >= 0 ? "#059669" : "#E11D48" }}>
                {rs(v2Live.net)}
              </p>
            </div>
          </div>
        )}
        {oldPerf.totalClosed > 0 && (
          <p className="text-[10.5px] text-slate-400">
            Old rules before v2: {oldPerf.totalClosed} closed calls, {oldPerf.accuracyPct ?? "—"}% accuracy, {oldPerf.netPoints >= 0 ? "+" : ""}
            {oldPerf.netPoints} premium points.
          </p>
        )}
      </div>

      {allCalls.length > 0 && (
        <div className="rounded-3xl bg-white shadow-md p-4">
          <p className="text-xs font-bold mb-1 text-slate-700 flex items-center gap-1.5">
            <Info size={13} className="text-sky-500" /> Call history
          </p>
          <p className="text-[10px] text-slate-400 mb-3">Every Ai20-20 call, newest first — tap one for its chart and why it was called.</p>
          <div className="space-y-2">
            {(historyOpen ? allCalls : allCalls.slice(0, 6)).map(({ key, symbol, v2, entry, verified }) => (
              <CallHistoryRow key={`${key}-${entry.id}`} symbol={symbol} entry={entry} verified={verified} v2={v2} onOpen={() => setDetail({ symbol, entry })} />
            ))}
            {allCalls.length > 6 && (
              <button onClick={() => setHistoryOpen((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-sky-600 py-1.5">
                {historyOpen ? "Show less" : `Show all ${allCalls.length}`}
                <ChevronDown size={13} className={`transition-transform ${historyOpen ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        </div>
      )}


      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference, not financial advice. Records are tests on past prices with costs taken off — real fills, spreads and fast markets differ. Never risk money you cannot afford to lose.
      </p>

      {detail && <CallDetailModal symbol={detail.symbol} entry={detail.entry} candles={board[detail.symbol].candles} candlesLoading={board[detail.symbol].loading} onClose={() => setDetail(null)} />}
    </div>
  );
}
