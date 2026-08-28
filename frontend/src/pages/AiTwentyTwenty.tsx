import { useMemo, useState } from "react";
import { Target, TrendingUp, TrendingDown, Gauge, ListChecks, RefreshCcw, Copy, Info, X, ChevronRight, ChevronDown, MessageCircle, CandlestickChart } from "lucide-react";
import { useMarketStatus, useCreateTrade, useSignal } from "../api/hooks";
import { useTradeLog, liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { useImmediateSuite } from "../hooks/useImmediateSuite";
import { analyzeImmediate, scanForAiTwenty, projectPremium20, LOT_SIZE, type AiTwentyCandidate } from "../utils/aiTwentyTwentyEngine";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { formatTipCard } from "../utils/tipFormat";
import { calculatePotentialLeft } from "../utils/kimiPlaybook";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { verifiedEntryIds } from "../utils/dedupeTradeLog";
import { checkReboundStrength } from "../utils/reboundStrength";
import { checkVolumeSupport } from "../utils/volumeSupport";
import { tickMarks, fmtWhen, formatExpiryTip, DetailRow, CallChart, PriceScale, ProfitEstimate, ReboundStrengthCard, VolumeSupportCard, ChatBubble, TradeLightSignal } from "../components/CallCardKit";
import { computeTradeLight } from "../utils/tradeLight";
import { NewsImpactCard } from "../components/NewsImpactCard";
import { ExpiryAlertBanner } from "../components/ExpiryAlertBanner";
import { VolatilityMeter } from "../components/VolatilityMeter";
import { useAppStore, type TradeLogEntry, type TradeLogStatus } from "../store/appStore";
import type { Decision6 } from "../utils/timeframeEngine";
import type { OptionsAnalytics, Candle } from "../types";

// Same password-gated manual override Best Call already uses for its own
// Force Stop button -- reused verbatim rather than inventing a second one.
const FORCE_STOP_PASSWORD = "SHANVI";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const keyPrefix = "TWENTY20";
// A candidate no longer belongs to any one candle timeframe (see
// aiTwentyTwentyEngine.ts's analyzeImmediate) -- this fixed pseudo-tf keeps
// every existing trade-log key ("TWENTY20-<SYMBOL>-<TF>") and its Call
// History/Track Record/detail-modal plumbing working unchanged.
const LIVE_TF = "LIVE";

const STATUS_LABEL: Record<TradeLogStatus, string> = {
  running: "Running",
  sl_hit: "SL Hit",
  stopped_breakeven: "Closed at Breakeven (T1)",
  stopped_after_t1: "Closed after T1 (T2 hit)",
  target3_hit: "Target 3 Hit",
  closed_manual: "Closed Manually",
};
const STATUS_COLOR: Record<TradeLogStatus, string> = {
  running: "text-sky-600",
  sl_hit: "text-rose-500",
  stopped_breakeven: "text-lime-600",
  stopped_after_t1: "text-emerald-600",
  target3_hit: "text-emerald-600",
  closed_manual: "text-slate-500",
};

// Trade-log keys here are "TWENTY20-<SYMBOL>-<TF>" -- symbol is always one
// plain word (CRUDEOIL/NATURALGAS, no dashes), so splitting on "-" cleanly
// recovers both the symbol and the timeframe out of a Call History key.
function parseTwentyKey(key: string): { symbol: TradableSymbol; tf: string } {
  const parts = key.split("-");
  return { symbol: parts[1] as TradableSymbol, tf: parts[2] };
}

function fmtLogTime(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function TwentyTradeLogLine({ entry, liveLtp }: { entry: TradeLogEntry; liveLtp: number | null }) {
  const dulled = entry.closed;
  const effStop = effectiveStopFor(entry);
  const nextTarget = entry.targetsHit[1] ? entry.targets[2] : entry.targetsHit[0] ? entry.targets[1] : entry.targets[0];
  const legFloor = entry.targetsHit[1] ? entry.targets[1] : entry.targetsHit[0] ? entry.targets[0] : entry.entry;
  const entryTiming = !dulled && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;
  return (
    <div className={`rounded-lg border px-2.5 py-2 transition-opacity ${dulled ? "opacity-50 bg-slate-50 border-slate-200" : "bg-white border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-700">
          {entry.strike} {entry.optSide} · Entry ₹{entry.entry}
        </span>
        <span className={`text-[10px] font-bold shrink-0 ${STATUS_COLOR[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
      </div>
      <p className="text-[9px] text-slate-400 mt-1">
        Called {fmtLogTime(entry.openedAt)}
        {entry.closedAt !== null ? ` · Closed ${fmtLogTime(entry.closedAt)}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-500">
        <span className={entry.targetsHit[0] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))} T3 ₹{entry.targets[2]}
        </span>
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="opacity-60"> (was ₹{entry.stop})</span>}
        </span>
      </div>
      {!dulled && liveLtp !== null && <p className="text-[10px] text-slate-400 mt-1">Current premium: ₹{liveLtp}</p>}
      {entryTiming && <EntryTimingBadge verdict={entryTiming} theme="light" className="mt-1.5" />}
    </div>
  );
}

function StatTile({ label, value, gradient }: { label: string; value: string; gradient: string }) {
  return (
    <div className="rounded-2xl p-3 text-center text-white shadow-sm" style={{ background: gradient }}>
      <p className="text-[9px] font-bold uppercase opacity-80">{label}</p>
      <p className="text-lg font-black">{value}</p>
    </div>
  );
}

function LightStatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2 bg-slate-50 border border-slate-100">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "inherit" }}>
        {value}
      </p>
    </div>
  );
}

function CategoryBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-slate-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: score >= 60 ? "#10B981" : score <= 40 ? "#EF4444" : "#F59E0B" }} />
      </div>
      <span className="text-[10px] font-bold text-slate-600 w-8 text-right">{Math.round(score)}</span>
    </div>
  );
}

function TwentyCandidateCard({
  candidate,
  tradeLogs,
  options,
  candles,
  expiry,
  loggedKey,
  setLoggedKey,
  copiedKey,
  setCopiedKey,
  createTrade,
  onOpenDetail,
}: {
  candidate: AiTwentyCandidate;
  tradeLogs: Record<string, TradeLogEntry[]>;
  options: OptionsAnalytics | undefined;
  candles: Candle[];
  expiry: string | undefined;
  loggedKey: string | null;
  setLoggedKey: (k: string | null) => void;
  copiedKey: string | null;
  setCopiedKey: (k: string | null) => void;
  createTrade: ReturnType<typeof useCreateTrade>;
  onOpenDetail: (symbol: TradableSymbol, entry: TradeLogEntry) => void;
}) {
  const forceCloseTradeLog = useAppStore((s) => s.forceCloseTradeLog);
  const [chatOpen, setChatOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const bullish = candidate.analysis.bias === "bullish";
  const accent = bullish ? "#0EA5E9" : "#F43F5E";
  const symbolKey = candidate.symbol as TradableSymbol;
  const tradeLogKey = `${keyPrefix}-${symbolKey}-${LIVE_TF}`;
  const log = tradeLogs[tradeLogKey] ?? [];
  const latest = log[log.length - 1];
  const openTrade = latest && !latest.closed ? latest : undefined;
  const liveLtp = openTrade ? liveLtpFor(options, openTrade.strike, openTrade.optSide) : null;
  const heroNextTarget = latest ? (latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0]) : null;
  const heroLegFloor = latest ? (latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry) : null;
  const heroEntryTiming = liveLtp !== null && heroNextTarget !== null && heroLegFloor !== null && latest ? evaluateEntryTiming(heroLegFloor, heroNextTarget, effectiveStopFor(latest), liveLtp) : null;
  const categories = candidate.analysis.categories;
  const lotSize = LOT_SIZE[symbolKey];
  const direction: "bullish" | "bearish" = bullish ? "bullish" : "bearish";
  const inBetween = !!openTrade && liveLtp !== null && liveLtp < openTrade.entry && liveLtp > effectiveStopFor(openTrade);
  const rebound = inBetween ? checkReboundStrength(candles, direction) : null;
  const volumeSupport = openTrade ? checkVolumeSupport(candles, direction) : null;
  const potential = latest && heroNextTarget !== null ? calculatePotentialLeft(latest.entry, latest.stop, heroNextTarget, liveLtp ?? latest.entry) : null;
  const tradeLight = heroEntryTiming && heroLegFloor !== null && heroNextTarget !== null && latest ? computeTradeLight(heroEntryTiming, rebound, heroLegFloor, heroNextTarget, effectiveStopFor(latest)) : null;
  // The point move that gets you to the profit-per-lot target is
  // symbol-specific (Crude Oil's own lot size makes that a 20-point move;
  // Natural Gas's much larger lot size means the same profit only needs a
  // couple of points) -- shown per-target once a real entry exists, rather
  // than a hardcoded "+20" that made sense for Crude but was an impossible
  // ask for NG.
  const delta = (target: number) => (latest ? `+${(target - latest.entry).toFixed(2)}` : "");
  // Entry/stop/targets are frozen the moment a trade log line opens (same
  // rule every engine in this app follows) -- an entry opened before a
  // target-formula change keeps its OLD numbers until it closes on its own.
  // This lets a stuck/stale entry (e.g. one left over from before this
  // profit-per-lot redesign) be manually cleared so a fresh one opens under
  // the current logic, the same password-gated override Best Call already has.
  const handleForceStop = () => {
    const pw = window.prompt("Enter password to clear this signal and let a fresh one open:");
    if (pw === null) return;
    if (pw !== FORCE_STOP_PASSWORD) {
      window.alert("Incorrect password.");
      return;
    }
    if (window.confirm("Clear this running signal now? A new one will open on the next qualifying scan. This can't be undone.")) {
      forceCloseTradeLog(tradeLogKey);
    }
  };

  const tip = latest
    ? formatTipCard({
        symbolLabel: DISPLAY_NAME[symbolKey],
        strike: latest.strike,
        optSide: latest.optSide,
        expiryLabel: formatExpiryTip(expiry),
        buyZoneLow: latest.entry,
        buyZoneHigh: Number((latest.entry * 1.02).toFixed(2)),
        targets: latest.targets,
        stopLoss: effectiveStopFor(latest),
      })
    : null;

  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden border-l-8" style={{ borderColor: accent }}>
      <div className="p-4 flex items-start justify-between gap-3" style={{ background: bullish ? "linear-gradient(135deg,#EFF6FF,#FFFFFF)" : "linear-gradient(135deg,#FFF1F2,#FFFFFF)" }}>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {DISPLAY_NAME[symbolKey]} · Live Momentum
          </p>
          <p className="text-lg font-black flex items-center gap-1.5" style={{ color: accent }}>
            {bullish ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {candidate.analysis.optSide} Quick Win
          </p>
          {latest && (
            <>
              <p className="text-sm font-bold text-slate-700 mt-0.5">
                {latest.strike} {latest.optSide} · Entry ₹{latest.entry} · {formatExpiryTip(expiry)} expiry
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Created {fmtWhen(latest.openedAt)} at ₹{latest.entry}
              </p>
            </>
          )}
        </div>
        <div className="text-center shrink-0">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-black text-[11px] shadow" style={{ background: accent }}>
            ₹2000
          </div>
          <p className="text-[9px] font-bold text-slate-400 mt-1">Per Lot at T1</p>
        </div>
      </div>

      {tradeLight && (
        <div className="px-4 pt-4">
          <TradeLightSignal verdict={tradeLight} />
        </div>
      )}

      <div className="px-4 pt-4">
        <NewsImpactCard symbol={symbolKey} />
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <LightStatTile label="Stop Loss" value={latest ? `₹${effectiveStopFor(latest)}` : "—"} color="#EF4444" />
          <LightStatTile label={`Target 1 ${delta(latest?.targets[0] ?? 0)}`} value={latest ? `₹${latest.targets[0]}` : "—"} color="#0EA5E9" />
          <LightStatTile label={`Target 2 ${delta(latest?.targets[1] ?? 0)}`} value={latest ? `₹${latest.targets[1]}` : "—"} color="#0EA5E9" />
          <LightStatTile label={`Target 3 ${delta(latest?.targets[2] ?? 0)}`} value={latest ? `₹${latest.targets[2]}` : "—"} color="#0EA5E9" />
          <LightStatTile label="Live Premium" value={liveLtp !== null ? `₹${liveLtp}` : "—"} color="#6366F1" />
          <LightStatTile label="Status" value={openTrade ? "Running" : latest ? "Closed" : "—"} color="#64748B" />
        </div>
        {latest && (
          <p className="text-[10px] text-slate-400">
            {lotSize} lot size -- Target 1 is worth ~₹{Math.round((latest.targets[0] - latest.entry) * lotSize)} on 1 lot.
          </p>
        )}
        {potential && (
          <div className="flex items-center gap-1">
            <span className="text-emerald-600">▲▲</span>
            <div>
              <p className="text-sm font-black text-emerald-600">{potential.potentialLeftPercent}%</p>
              <p className="text-[10px] text-slate-400">Potential left to next target</p>
            </div>
          </div>
        )}

        {tip && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(tip);
                setCopiedKey(tradeLogKey);
                setTimeout(() => setCopiedKey(null), 2000);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-50 border border-slate-100 text-slate-700"
            >
              <Copy size={13} />
              {copiedKey === tradeLogKey ? "Copied ✓" : "Copy"}
            </button>
            {openTrade && (
              <button
                disabled={loggedKey === tradeLogKey}
                onClick={() =>
                  createTrade.mutate(
                    {
                      symbol: symbolKey,
                      optSide: openTrade.optSide,
                      strike: openTrade.strike,
                      entryPrice: openTrade.entry,
                      stopLoss: openTrade.stop,
                      target: openTrade.targets[0],
                      quantity: 1,
                      lotSize,
                      source: "master-ai",
                      notes: "Logged from Ai20-20",
                    },
                    { onSuccess: () => setLoggedKey(tradeLogKey) }
                  )
                }
                className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                style={{ background: accent }}
              >
                {loggedKey === tradeLogKey ? "Logged ✓" : "Buy"}
              </button>
            )}
          </div>
        )}

        {categories && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase text-slate-400">Why this qualified (live, not tied to any candle timeframe)</p>
            <CategoryBar label="Trend" score={bullish ? categories.trend.score : 100 - categories.trend.score} />
            <CategoryBar label="Momentum" score={bullish ? categories.momentum.score : 100 - categories.momentum.score} />
            <CategoryBar label="Price Action" score={bullish ? categories.priceAction.score : 100 - categories.priceAction.score} />
            <CategoryBar label="Live Premium" score={bullish ? categories.premiumMomentum.score : 100 - categories.premiumMomentum.score} />
          </div>
        )}
        <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <ListChecks size={12} className="shrink-0 mt-0.5 text-sky-500" /> {candidate.reason}
        </p>
      </div>

      {latest && (
        <>
          <PriceScale entry={latest} current={latest.closed ? null : liveLtp} />
          <ProfitEstimate trade={latest} current={latest.closed ? null : liveLtp} lotSize={lotSize} />
          {rebound && <ReboundStrengthCard rebound={rebound} />}
          <VolumeSupportCard volume={volumeSupport} />
        </>
      )}

      <div className="px-4 pb-4">
        {log.length > 0 && (
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase text-slate-400">Trade Log (newest first)</p>
              {openTrade && (
                <button onClick={handleForceStop} className="flex items-center gap-1 text-[9px] font-bold text-slate-400 underline underline-offset-2">
                  <RefreshCcw size={10} />
                  Clear stale signal
                </button>
              )}
            </div>
            {(logOpen ? [...log].reverse() : [...log].reverse().slice(0, 3)).map((entry) => (
              <button key={entry.id} onClick={() => onOpenDetail(symbolKey, entry)} className="w-full text-left">
                <TwentyTradeLogLine entry={entry} liveLtp={entry.id === openTrade?.id ? liveLtp : null} />
              </button>
            ))}
            {log.length > 3 && (
              <button onClick={() => setLogOpen((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[11px] font-bold text-sky-600 py-1.5">
                {logOpen ? "Show less" : `Show all ${log.length}`}
                <ChevronDown size={13} className={`transition-transform ${logOpen ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        )}

        {latest && (
          <>
            <button
              onClick={() => setChartOpen((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border mb-2 border-slate-200 bg-slate-50 text-sky-600"
            >
              <CandlestickChart size={14} />
              View Chart
              <ChevronDown size={14} className={`transition-transform ${chartOpen ? "rotate-180" : ""}`} />
            </button>
            {chartOpen && (
              <div className="mb-2 rounded-xl p-3 border border-slate-200 bg-slate-50">
                <CallChart candles={candles} entry={latest} loading={candles.length === 0} errorReason={null} />
              </div>
            )}
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-sky-600"
            >
              <MessageCircle size={14} />
              Chat about this call
              <ChevronDown size={14} className={`transition-transform ${chatOpen ? "rotate-180" : ""}`} />
            </button>
            {chatOpen && (
              <div className="mt-2 rounded-xl p-3 space-y-3 border border-slate-200 bg-slate-50">
                <p className="text-[9px] text-slate-400">Answers below are built from this call's own real numbers — not a free-text chat model.</p>
                <ChatBubble q="Why was this call made?" a={candidate.reason} />
                <ChatBubble
                  q="What's happening right now?"
                  a={
                    latest.closed
                      ? `Closed: ${latest.status.replace(/_/g, " ")} at ₹${exitPriceFor(latest)}, ${exitPriceFor(latest) - latest.entry >= 0 ? "a gain" : "a loss"} of ${Math.abs(Number((exitPriceFor(latest) - latest.entry).toFixed(2)))} points from the ₹${latest.entry} entry.`
                      : `Current premium ₹${liveLtp ?? latest.entry} vs entry ₹${latest.entry}${
                          potential ? ` -- ${potential.potentialLeftPercent}% of the move to the next target is still left to capture.` : "."
                        }${rebound ? ` Rebound check: ${rebound.label} (${rebound.score}% of checks still favor the original direction).` : ""}`
                  }
                />
                <ChatBubble
                  q="What if the target fails?"
                  a={
                    latest.targetsHit[0]
                      ? `Target 1 was already reached, so the stop has already trailed up to ₹${effectiveStopFor(latest)}${latest.targetsHit[1] ? " (locking the Target 1-2 gain)" : " (breakeven)"} -- it won't wait for the original ₹${latest.stop} anymore.`
                      : `It hasn't reached Target 1 yet, so the original stop loss ₹${latest.stop} still applies.`
                  }
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function CallHistoryRow({ symbol, entry, verified, onOpen }: { symbol: TradableSymbol; entry: TradeLogEntry; verified: boolean; onOpen: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "#059669" : pnl !== null && pnl < 0 ? "#E11D48" : "#B45309";
  const effStop = effectiveStopFor(entry);

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl border px-3 py-2.5 active:bg-slate-50"
      style={{ borderColor: verified ? "#E2E8F0" : "#FCA5A5", opacity: verified ? 1 : 0.6 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate text-slate-700">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}
          </p>
          <p className="text-[10px] text-slate-400">
            Called {fmtWhen(entry.openedAt)} at ₹{entry.entry}
            {entry.closed && entry.closedAt !== null && (
              <>
                {" "}
                · Closed {fmtWhen(entry.closedAt)} at ₹{exit}
              </>
            )}
          </p>
          {verified ? (
            <span className="inline-block mt-1 text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#DCFCE7", color: "#15803D" }}>
              ✓ Verified
            </span>
          ) : (
            <span className="inline-block mt-1 text-[9px] font-black px-1.5 py-0.5 rounded-full" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
              Duplicate — excluded from accuracy
            </span>
          )}
        </div>
        <div className="text-right shrink-0 flex items-center gap-1">
          <div>
            <p className="text-xs font-bold" style={{ color: statusColor }}>
              {statusLabel}
            </p>
            {pnl !== null && (
              <p className="text-[10px] text-slate-400">
                {pnl >= 0 ? "+" : ""}
                {pnl} pts
              </p>
            )}
          </div>
          <ChevronRight size={14} className="text-slate-400 shrink-0" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-slate-400">
        <span className={entry.targetsHit[0] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-emerald-600 font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))} T3 ₹{entry.targets[2]}
        </span>
        <span>
          SL ₹{effStop}
          {effStop !== entry.stop && <span className="opacity-60"> (was ₹{entry.stop})</span>}
        </span>
      </div>
    </button>
  );
}

function CallDetailModal({
  symbol,
  entry,
  candles,
  candlesLoading,
  onClose,
}: {
  symbol: TradableSymbol;
  entry: TradeLogEntry;
  candles: Candle[];
  candlesLoading: boolean;
  onClose: () => void;
}) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "#059669" : pnl !== null && pnl < 0 ? "#E11D48" : "#B45309";
  const effStop = effectiveStopFor(entry);
  const direction = entry.optSide === "CE" ? "bullish" : "bearish";
  const Bias = direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = direction === "bullish" ? "#059669" : "#E11D48";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black flex items-center gap-2 text-slate-800">
            <Bias size={20} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol]} {entry.strike} {entry.optSide}
          </p>
          <button onClick={onClose} className="p-2 rounded-full bg-slate-100 shrink-0">
            <X size={18} />
          </button>
        </div>
        <p className="text-sm font-bold mb-3 text-sky-600">Ai20-20 Quick Win</p>

        <div className="rounded-2xl p-3.5 mb-3 bg-slate-50">
          <p className="text-lg font-black" style={{ color: statusColor }}>
            {statusLabel}
          </p>
          {pnl !== null && (
            <p className="text-sm font-bold text-slate-400">
              {pnl >= 0 ? "+" : ""}
              {pnl} points
            </p>
          )}
        </div>

        <div>
          <DetailRow label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
          {entry.closed && entry.closedAt !== null && <DetailRow label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
          <DetailRow label="Entry" value={`₹${entry.entry}`} />
          <DetailRow label="Target 1" value={`₹${entry.targets[0]}  ${tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))}`} valueColor={entry.targetsHit[0] ? "#059669" : undefined} />
          <DetailRow label="Target 2" value={`₹${entry.targets[1]}  ${tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))}`} valueColor={entry.targetsHit[1] ? "#059669" : undefined} />
          <DetailRow label="Target 3" value={`₹${entry.targets[2]}  ${tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))}`} valueColor={entry.targetsHit[2] ? "#059669" : undefined} />
          <DetailRow label="Stop Loss" value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`} valueColor="#E11D48" />
        </div>

        <div className="mt-4 -mx-5">
          <PriceScale entry={entry} current={entry.closed ? exit : null} />
          <ProfitEstimate trade={entry} current={entry.closed ? exit : null} lotSize={LOT_SIZE[symbol]} />
        </div>

        <div className="mt-4">
          <p className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
            <CandlestickChart size={13} />
            Chart
          </p>
          <CallChart candles={candles} entry={entry} loading={candlesLoading} errorReason={null} />
        </div>
      </div>
    </div>
  );
}

export function AiTwentyTwenty() {
  const { data: market } = useMarketStatus();
  const createTrade = useCreateTrade();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ symbol: TradableSymbol; entry: TradeLogEntry } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const crudeOil = useImmediateSuite("CRUDEOIL");
  const naturalGas = useImmediateSuite("NATURALGAS");
  const board: Record<TradableSymbol, ReturnType<typeof useImmediateSuite>> = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };
  const { data: crudeSignal } = useSignal("CRUDEOIL");
  const { data: gasSignal } = useSignal("NATURALGAS");
  const expiryBySymbol: Record<TradableSymbol, string | undefined> = { CRUDEOIL: crudeSignal?.expiry, NATURALGAS: gasSignal?.expiry };

  // No candle timeframe to bucket by anymore -- one live read per symbol,
  // built straight from fast candles + the option's own live premium
  // momentum (see analyzeImmediate / useImmediateSuite).
  const crudeAnalysis = useMemo(() => analyzeImmediate(crudeOil.candles, crudeOil.ceMomentumPct, crudeOil.peMomentumPct), [crudeOil.candles, crudeOil.ceMomentumPct, crudeOil.peMomentumPct]);
  const gasAnalysis = useMemo(() => analyzeImmediate(naturalGas.candles, naturalGas.ceMomentumPct, naturalGas.peMomentumPct), [naturalGas.candles, naturalGas.ceMomentumPct, naturalGas.peMomentumPct]);

  const candidates = useMemo(
    () =>
      scanForAiTwenty([
        { symbol: "CRUDEOIL", analysis: crudeAnalysis },
        { symbol: "NATURALGAS", analysis: gasAnalysis },
      ]),
    [crudeAnalysis, gasAnalysis]
  );

  const crudeOilAnalyses = useMemo(
    () => [
      {
        tf: LIVE_TF,
        decision: (candidates.some((c) => c.symbol === "CRUDEOIL") ? (crudeAnalysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT") as Decision6,
        insufficient: crudeAnalysis.insufficient,
        optSide: crudeAnalysis.optSide,
      },
    ],
    [crudeAnalysis, candidates]
  );
  const naturalGasAnalyses = useMemo(
    () => [
      {
        tf: LIVE_TF,
        decision: (candidates.some((c) => c.symbol === "NATURALGAS") ? (gasAnalysis.bias === "bullish" ? "STRONG BUY" : "STRONG SELL") : "WAIT") as Decision6,
        insufficient: gasAnalysis.insufficient,
        optSide: gasAnalysis.optSide,
      },
    ],
    [gasAnalysis, candidates]
  );
  const crudeOilProjections = useMemo(() => [projectPremium20(crudeAnalysis, crudeOil.options)], [crudeAnalysis, crudeOil.options]);
  const naturalGasProjections = useMemo(() => [projectPremium20(gasAnalysis, naturalGas.options)], [gasAnalysis, naturalGas.options]);

  useTradeLog("CRUDEOIL", crudeOilAnalyses, crudeOilProjections, crudeOil.options, `${keyPrefix}-CRUDEOIL`);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGasAnalyses, naturalGasProjections, naturalGas.options, `${keyPrefix}-NATURALGAS`);

  const twentyTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith(`${keyPrefix}-`)) out[k] = v;
    return out;
  }, [tradeLogs]);

  // Two clients sharing this one login-less trade log can each open their
  // own duplicate entry for the same real signal before syncing -- re-derive
  // the same verdict Best Call already uses so accuracy/track-record are
  // always correct regardless of reload timing.
  const verifiedIdsByKey = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(twentyTradeLogsOnly)) out[k] = verifiedEntryIds(v);
    return out;
  }, [twentyTradeLogsOnly]);
  const verifiedTradeLogs = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(twentyTradeLogsOnly)) out[k] = v.filter((e) => verifiedIdsByKey[k]?.has(e.id));
    return out;
  }, [twentyTradeLogsOnly, verifiedIdsByKey]);
  const realized = useMemo(() => flattenClosedTrades(verifiedTradeLogs), [verifiedTradeLogs]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(twentyTradeLogsOnly), [twentyTradeLogsOnly]);

  // Every Ai20-20 call ever made (open or closed), newest first.
  const allCalls = useMemo(() => {
    const out: { symbol: TradableSymbol; entry: TradeLogEntry; verified: boolean }[] = [];
    for (const [k, v] of Object.entries(twentyTradeLogsOnly)) {
      const { symbol } = parseTwentyKey(k);
      for (const entry of v) out.push({ symbol, entry, verified: verifiedIdsByKey[k]?.has(entry.id) ?? true });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [twentyTradeLogsOnly, verifiedIdsByKey]);

  const candlesFor = (symbol: TradableSymbol) => board[symbol].candles;

  const anyLiveDataUnavailable = crudeOil.liveDataUnavailable || naturalGas.liveDataUnavailable;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-5" style={{ background: "linear-gradient(180deg,#EFF6FF,#F0FDFA 40%,#F8FAFC)" }}>
      <section className="text-center pt-2 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Target size={24} className="text-sky-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-sky-500 via-cyan-500 to-emerald-500 bg-clip-text text-transparent">Ai20-20</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-4">
          Best Call and AI Verify Pro are deliberately strict and go quiet once a call closes or runs past its move -- Ai20-20 fills that gap. This isn't tied to any 15m/1H/4H candle closing: it reads fast (5-minute) price action AND the
          option's own live premium movement, refreshed roughly every 8 seconds, so a call can qualify the moment real momentum shows up. A modest, flat <span className="font-bold text-slate-700">₹2000-per-lot profit target</span> is "enough"
          here (that's 20 points for Crude Oil's own lot size, a smaller move for Natural Gas's much bigger lot size). Ai20-20 is a fully independent scanner with its own trade log -- it never mirrors Best Call's own picks or hits, since the
          two run different engines and can (and often do) disagree on the same moment.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Markets Scanned" value="2" gradient="linear-gradient(135deg,#0EA5E9,#06B6D4)" />
        <StatTile label="Live Refresh" value="~8s" gradient="linear-gradient(135deg,#06B6D4,#10B981)" />
        <StatTile label="Qualifying Now" value={String(candidates.length)} gradient="linear-gradient(135deg,#6366F1,#0EA5E9)" />
      </div>

      <ExpiryAlertBanner />

      <div className="grid grid-cols-2 gap-2">
        <VolatilityMeter symbol="CRUDEOIL" />
        <VolatilityMeter symbol="NATURALGAS" />
      </div>

      {anyLiveDataUnavailable && (
        <div className="rounded-2xl bg-white border border-rose-200 p-4 text-center shadow-sm">
          <p className="text-sm font-bold text-rose-500">Live data unavailable</p>
          <p className="text-xs text-slate-500 mt-1">Option chain unreachable for one or both markets — no entry, target, or stop loss is fabricated while this is down.</p>
        </div>
      )}

      {candidates.length === 0 ? (
        <section className="rounded-3xl bg-white shadow-md p-8 text-center space-y-2">
          <Gauge size={28} className="mx-auto text-sky-400 animate-pulse" />
          <p className="text-base font-black text-slate-700">No Quick Win Setup Right Now</p>
          <p className="text-xs text-slate-500 px-4">Still scanning both markets' live premium and fast price action roughly every 8 seconds — nothing has a clean directional read yet. Check back shortly.</p>
        </section>
      ) : (
        <div className="space-y-3">
          {candidates.map((c) => (
            <TwentyCandidateCard
              key={c.symbol}
              candidate={c}
              tradeLogs={tradeLogs}
              options={board[c.symbol as TradableSymbol].options}
              candles={candlesFor(c.symbol as TradableSymbol)}
              expiry={expiryBySymbol[c.symbol as TradableSymbol]}
              loggedKey={loggedKey}
              setLoggedKey={setLoggedKey}
              copiedKey={copiedKey}
              setCopiedKey={setCopiedKey}
              createTrade={createTrade}
              onOpenDetail={(symbol, entry) => setDetail({ symbol, entry })}
            />
          ))}
        </div>
      )}

      <div className="rounded-3xl bg-white shadow-md p-4">
        <p className="text-xs font-bold mb-3 text-slate-700">Ai20-20 Track Record</p>
        <div className="grid grid-cols-3 gap-2">
          <LightStatTile label="Closed" value={String(perf.totalClosed)} />
          <LightStatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <LightStatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "#059669" : "#E11D48"} />
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Tracked separately from every other page's own trade log, starting from zero the day this page shipped.</p>
      </div>

      {allCalls.length > 0 && (
        <div className="rounded-3xl bg-white shadow-md p-4">
          <p className="text-xs font-bold mb-1 text-slate-700 flex items-center gap-1.5">
            <Info size={13} className="text-sky-500" /> Call History
          </p>
          <p className="text-[10px] text-slate-400 mb-3">Every Ai20-20 call ever made, newest first — exact time/price called, and once closed, exact time/price of whichever target/breakeven/stop rule actually closed it.</p>
          <div className="space-y-2">
            {(historyOpen ? allCalls : allCalls.slice(0, 6)).map(({ symbol, entry, verified }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} verified={verified} onOpen={() => setDetail({ symbol, entry })} />
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

      {/* DAY-WISE TRADE LOG */}
      <section className="rounded-3xl bg-white shadow-md p-4 overflow-x-auto">
        <p className="text-xs font-bold uppercase text-slate-500 mb-1 flex items-center gap-1.5">
          <Target size={13} className="text-sky-500" /> Day-wise Trade Log — Both Symbols
        </p>
        <p className="text-[10px] text-slate-400 mb-3">One MCX session = 9:00am – 11:55pm IST. Counts every closed trade across both markets.</p>
        {dayStats.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-3">No trades have closed yet — this fills in as calls run their course.</p>
        ) : (
          <table className="w-full text-[11px] min-w-[420px]">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="font-semibold pb-2">Date</th>
                <th className="font-semibold pb-2">Target Hit</th>
                <th className="font-semibold pb-2">Breakeven</th>
                <th className="font-semibold pb-2">SL Hit</th>
                <th className="font-semibold pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {dayStats.map((d) => (
                <tr key={d.dateKey} className="border-t border-slate-100">
                  <td className="py-2 font-semibold text-slate-700">{d.label}</td>
                  <td className="py-2 font-bold text-emerald-600">{d.targetHit}</td>
                  <td className="py-2 font-bold text-lime-600">{d.breakeven}</td>
                  <td className="py-2 font-bold text-rose-500">{d.slHit}</td>
                  <td className="py-2 text-slate-500">{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Entry/stop/target numbers are always computed deterministically from real live data. A lower, more frequent bar means more signals but a
        weaker edge per signal than Best Call -- always confirm on the live chart before acting.
      </p>

      {detail && (
        <CallDetailModal
          symbol={detail.symbol}
          entry={detail.entry}
          candles={candlesFor(detail.symbol)}
          candlesLoading={board[detail.symbol].loading}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
