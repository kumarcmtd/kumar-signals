import { useMemo, useState } from "react";
import { Copy, Info, ShieldCheck, TrendingUp, TrendingDown, X, ChevronRight, ChevronDown, Lock, MessageCircle, CandlestickChart, Wallet } from "lucide-react";
import { useCreateTrade, usePortfolio, useCandles } from "../api/hooks";
import { useBestCallForSymbol, type TradableSymbol } from "../hooks/useBestCall";
import { liveLtpFor, effectiveStopFor } from "../hooks/useTradeLog";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { calculatePotentialLeft } from "../utils/kimiPlaybook";
import { formatTipCard } from "../utils/tipFormat";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { type BestCallPick, type BestCallSource } from "../utils/bestCallSelector";
import { checkReboundStrength, type ReboundTier } from "../utils/reboundStrength";
import { checkVolumeSupport, type VolumeSupportTier } from "../utils/volumeSupport";
import { verifiedEntryIds } from "../utils/dedupeTradeLog";
import { evaluateEntryTiming } from "../utils/entryTiming";
import { EntryTimingBadge } from "../components/EntryTimingBadge";
import { TradeChart, type ChartMarkerSpec } from "../components/TradeChart";
import type { Candle } from "../types";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SOURCE_COLOR: Record<BestCallSource, string> = { "AI Elite": "#7C3AED", "Directional Gate": "#0891B2", "Kimi Playbook": "#B45309", "Pattern Signal": "#0D9488" };
// A soft accidental-tap guard, not real security -- this is a public client
// bundle, so anyone who opens devtools can read this string. It exists to
// stop a stray tap from silently ending a live trade, not to gate access.
const FORCE_STOP_PASSWORD = "SHANVI";

// 0 touches -> a plain unfilled circle; 1-3 -> that many ticks; 4+ -> a
// single tick with a count, so a target that keeps getting re-tested doesn't
// blow out the row width.
function tickMarks(count: number): string {
  if (count <= 0) return "○";
  if (count <= 3) return "✓".repeat(count);
  return `✓×${count}`;
}

function formatExpiryTip(expiry: string | undefined): string {
  if (!expiry) return "—";
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

// Marks the exact candle the call opened in (and closed in, if it's done) on
// the UNDERLYING's own price chart. Entry/target/stop are option-PREMIUM
// levels, not underlying price levels, so they're deliberately not drawn as
// horizontal lines here (that would put ₹3.50 premium lines on a ₹280
// futures-price scale) -- this chart exists purely to let a person visually
// re-check what the underlying was actually doing at and after the moment
// this call fired, same market data the engines themselves scanned.
function callChartMarkers(entry: TradeLogEntry): ChartMarkerSpec[] {
  const bullish = entry.optSide === "CE";
  const out: ChartMarkerSpec[] = [
    {
      timeMs: entry.openedAt,
      color: bullish ? "#16a34a" : "#dc2626",
      shape: bullish ? "arrowUp" : "arrowDown",
      text: `CALL ₹${entry.entry}`,
      position: bullish ? "belowBar" : "aboveBar",
    },
  ];
  if (entry.closed && entry.closedAt !== null) {
    out.push({ timeMs: entry.closedAt, color: "#6b7280", shape: "circle", text: "CLOSED", position: "aboveBar" });
  }
  return out;
}

function CallChart({
  candles,
  entry,
  loading,
  errorReason,
}: {
  candles: Candle[];
  entry: TradeLogEntry;
  loading: boolean;
  errorReason?: string | null;
}) {
  const markers = useMemo(() => callChartMarkers(entry), [entry]);
  // The worker only ever returns this reason (rather than throwing) when the
  // underlying's own candle history genuinely isn't ready yet -- almost
  // always the first ~20 minutes right after MCX opens, before today's
  // 1-minute feed has enough bars to resample to 15m. That's exactly when a
  // fresh call is most likely to fire (opening-range moves), so this shows
  // up more than its rarity suggests -- worth explaining plainly rather than
  // a bare "no data" that reads as broken.
  const emptyMessage = loading
    ? "Loading chart…"
    : errorReason
    ? `${errorReason}. This is a normal gap right after market open — check back in a few minutes.`
    : "No chart data available yet.";
  return (
    <div>
      {candles.length > 0 ? (
        <TradeChart candles={candles} priceLines={[]} markers={markers} height={220} theme="light" />
      ) : (
        <p className="text-xs text-[var(--color-muted)] text-center py-6 px-2">{emptyMessage}</p>
      )}
      <p className="text-[9px] text-[var(--color-muted)] mt-1.5 px-1">
        Underlying 15m price action, not the option premium — the marked candle is exactly when this call was called
        {entry.closed ? " and closed" : ""}. Targets/SL are premium levels (see the numbers above), so they aren't drawn on this price scale.
      </p>
    </div>
  );
}

export function BestCall() {
  const { data: trades } = usePortfolio();
  const createTrade = useCreateTrade();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ symbol: TradableSymbol; entry: TradeLogEntry } | null>(null);
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const crudeOil = useBestCallForSymbol("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useBestCallForSymbol("NATURALGAS", journalSummary.winRate);
  const board = { CRUDEOIL: crudeOil, NATURALGAS: naturalGas };

  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const bestTradeLogsOnly = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(tradeLogs)) if (k.startsWith("BEST-")) out[k] = v;
    return out;
  }, [tradeLogs]);
  // Two clients sharing this one login-less trade log can each open their
  // own duplicate entry for the same real signal before syncing -- the sync
  // merge now drops the loser going forward, but a browser that hasn't
  // reloaded since can still be holding stale duplicates locally. Re-deriving
  // the same verdict here means accuracy/track-record are always correct
  // regardless of reload timing, and Call History can show the user exactly
  // which entry is the one actually being counted instead of asking them to
  // trust an invisible background fix.
  const verifiedIdsByKey = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(bestTradeLogsOnly)) out[k] = verifiedEntryIds(v);
    return out;
  }, [bestTradeLogsOnly]);
  const verifiedTradeLogs = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const [k, v] of Object.entries(bestTradeLogsOnly)) out[k] = v.filter((e) => verifiedIdsByKey[k]?.has(e.id));
    return out;
  }, [bestTradeLogsOnly, verifiedIdsByKey]);
  const realized = useMemo(() => flattenClosedTrades(verifiedTradeLogs), [verifiedTradeLogs]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(verifiedTradeLogs), [verifiedTradeLogs]);

  const bySource = useMemo(() => {
    const sources: BestCallSource[] = ["AI Elite", "Directional Gate", "Kimi Playbook"];
    return sources.map((source) => {
      const closed = realized.filter((r) => r.entry.meta?.label === source);
      const wins = closed.filter((r) => r.pnlPoints > 0).length;
      const losses = closed.filter((r) => r.pnlPoints < 0).length;
      const decided = wins + losses;
      return { source, total: closed.length, winRate: decided > 0 ? Math.round((wins / decided) * 100) : null };
    });
  }, [realized]);

  // Every Best Call ever made (open or closed), newest first -- the exact
  // time + price it was called, and (once closed) the exact time + price the
  // target/breakeven/stop rule that closed it actually acted on.
  const allCalls = useMemo(() => {
    const out: { symbol: TradableSymbol; entry: TradeLogEntry; verified: boolean }[] = [];
    for (const [k, v] of Object.entries(bestTradeLogsOnly)) {
      const symbol = k.replace("BEST-", "") as TradableSymbol;
      for (const entry of v) out.push({ symbol, entry, verified: verifiedIdsByKey[k]?.has(entry.id) ?? true });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [bestTradeLogsOnly, verifiedIdsByKey]);

  // A call must keep showing up top for as long as it's still RUNNING, even
  // if this particular poll's fresh re-scan doesn't currently re-detect the
  // exact same firing condition (a candlestick/setup match is momentary by
  // nature -- the underlying trade is still open and tracked against live
  // premium regardless). Only hide a symbol's card once its latest tracked
  // call has actually CLOSED and nothing new is currently live to replace it.
  const hasVisibleCall = (b: { trackingKey: string; best: BestCallPick | null }) => {
    const latest = tradeLogs[b.trackingKey]?.[tradeLogs[b.trackingKey].length - 1];
    return !!latest && (!latest.closed || !!b.best);
  };
  const anyPick = hasVisibleCall(crudeOil) || hasVisibleCall(naturalGas);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-[var(--color-primary)]" />
          <p className="text-sm font-bold">Best Call</p>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-1.5">
          Compares three independent engines already running elsewhere in this app — AI Elite (strict Strong Buy/Sell + confluence),
          the Directional Gate (multi-timeframe trend + ADX + volume), and the Kimi setup scanner — and shows only the single
          highest-confidence pick per instrument. When none of the three currently qualifies, that instrument shows no call rather
          than a weaker one just to fill the space.
        </p>
      </div>

      {!anyPick && (
        <div className="card p-6 text-center space-y-2">
          <Info size={26} className="mx-auto text-[var(--color-muted)]" />
          <p className="text-sm font-bold">No qualifying call right now</p>
          <p className="text-xs text-[var(--color-muted)] px-2">
            Neither Crude Oil nor Natural Gas currently clears any of the three engines' bars. This is expected most of the time —
            check back after the next candle close.
          </p>
        </div>
      )}

      {SYMBOLS.map((symbol) => {
        const b = board[symbol];
        if (!hasVisibleCall(b)) return null;
        return (
          <BestCallCard
            key={symbol}
            symbol={symbol}
            data={b}
            tradeLogs={tradeLogs}
            loggedKey={loggedKey}
            setLoggedKey={setLoggedKey}
            copiedKey={copiedKey}
            setCopiedKey={setCopiedKey}
            createTrade={createTrade}
          />
        );
      })}

      <div className="card p-4">
        <p className="text-xs font-bold mb-3">Best Call Track Record</p>
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Closed" value={String(perf.totalClosed)} />
          <StatTile label="Accuracy" value={perf.accuracyPct !== null ? `${perf.accuracyPct}%` : "—"} />
          <StatTile label="Net Points" value={`${perf.netPoints >= 0 ? "+" : ""}${perf.netPoints}`} color={perf.netPoints >= 0 ? "var(--color-buy)" : "var(--color-sell)"} />
        </div>
        <p className="text-[10px] text-[var(--color-muted)] mt-2">
          Tracked separately from every other page's own trade log, starting from zero the day this page shipped.
        </p>
      </div>

      <div className="card p-4">
        <p className="text-xs font-bold mb-3">Which Engine Wins More</p>
        <div className="space-y-2">
          {bySource.map((s) => (
            <div key={s.source} className="flex items-center justify-between text-xs">
              <span className="font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: SOURCE_COLOR[s.source] }} />
                {s.source}
              </span>
              <span className="text-[var(--color-muted)]">
                {s.total} closed{s.winRate !== null ? ` · ${s.winRate}% win rate` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {allCalls.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-1">Call History</p>
          <p className="text-[10px] text-[var(--color-muted)] mb-3">
            Every Best Call ever made, newest first — exact time and price it was called, and once closed, exact time and price of
            whichever target/breakeven/stop rule actually closed it.
          </p>
          <div className="space-y-2">
            {allCalls.map(({ symbol, entry, verified }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} verified={verified} onOpen={() => setDetail({ symbol, entry })} />
            ))}
          </div>
        </div>
      )}

      {dayStats.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-bold mb-3">Day-wise Log</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[380px]">
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <th className="font-semibold pb-2">Date</th>
                  <th className="font-semibold pb-2">Target Hit</th>
                  <th className="font-semibold pb-2">Breakeven</th>
                  <th className="font-semibold pb-2">SL Hit</th>
                </tr>
              </thead>
              <tbody>
                {dayStats.map((d) => (
                  <tr key={d.dateKey} className="border-t border-[var(--color-border)]">
                    <td className="py-2 font-semibold">{d.label}</td>
                    <td className="py-2 font-bold text-[var(--color-buy)]">{d.targetHit}</td>
                    <td className="py-2 font-bold text-amber-600">{d.breakeven}</td>
                    <td className="py-2 font-bold text-[var(--color-sell)]">{d.slHit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Always confirm on the live chart before acting.
      </p>

      {detail && <CallDetailModal symbol={detail.symbol} entry={detail.entry} onClose={() => setDetail(null)} />}
    </div>
  );
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CallHistoryRow({ symbol, entry, verified, onOpen }: { symbol: TradableSymbol; entry: TradeLogEntry; verified: boolean; onOpen: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "var(--color-buy)" : pnl !== null && pnl < 0 ? "var(--color-sell)" : "#B45309";
  const effStop = effectiveStopFor(entry);

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl border px-3 py-2.5 active:bg-[var(--color-surface-soft)]"
      style={{ borderColor: verified ? "var(--color-border)" : "#FCA5A5", opacity: verified ? 1 : 0.6 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">
            {DISPLAY_NAME[symbol]} · {entry.strike} {entry.optSide}
            {entry.meta?.label ? ` · ${entry.meta.label}` : ""}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">
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
              <p className="text-[10px] text-[var(--color-muted)]">
                {pnl >= 0 ? "+" : ""}
                {pnl} pts
              </p>
            )}
          </div>
          <ChevronRight size={14} className="text-[var(--color-muted)] shrink-0" />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[10px] text-[var(--color-muted)]">
        <span className={entry.targetsHit[0] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))} T1 ₹{entry.targets[0]}
        </span>
        <span className={entry.targetsHit[1] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))} T2 ₹{entry.targets[1]}
        </span>
        <span className={entry.targetsHit[2] ? "text-[var(--color-buy)] font-semibold" : ""}>
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

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
      <span className="text-sm text-[var(--color-muted)]">{label}</span>
      <span className="text-base font-bold" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

function CallDetailModal({ symbol, entry, onClose }: { symbol: TradableSymbol; entry: TradeLogEntry; onClose: () => void }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "var(--color-buy)" : pnl !== null && pnl < 0 ? "var(--color-sell)" : "#B45309";
  const effStop = effectiveStopFor(entry);
  const direction = entry.optSide === "CE" ? "bullish" : "bearish";
  const Bias = direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = direction === "bullish" ? "var(--color-buy)" : "var(--color-sell)";
  const source = entry.meta?.label as BestCallSource | undefined;
  const { data: candleData, isLoading: candlesLoading } = useCandles(symbol, "15");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full sm:max-w-md bg-[var(--color-surface)] rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-xl font-black flex items-center gap-2">
            <Bias size={20} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol]} {entry.strike} {entry.optSide}
          </p>
          <button onClick={onClose} className="p-2 rounded-full bg-[var(--color-surface-soft)] shrink-0">
            <X size={18} />
          </button>
        </div>
        {source && (
          <p className="text-sm font-bold mb-3" style={{ color: SOURCE_COLOR[source] }}>
            {source}
          </p>
        )}

        <div className="rounded-2xl p-3.5 mb-3" style={{ background: "var(--color-surface-soft)" }}>
          <p className="text-lg font-black" style={{ color: statusColor }}>
            {statusLabel}
          </p>
          {pnl !== null && (
            <p className="text-sm font-bold text-[var(--color-muted)]">
              {pnl >= 0 ? "+" : ""}
              {pnl} points
            </p>
          )}
        </div>

        <div>
          <DetailRow label="Called" value={`${fmtWhen(entry.openedAt)} at ₹${entry.entry}`} />
          {entry.closed && entry.closedAt !== null && <DetailRow label="Closed" value={`${fmtWhen(entry.closedAt)} at ₹${exit}`} />}
          <DetailRow label="Entry" value={`₹${entry.entry}`} />
          <DetailRow label="Target 1" value={`₹${entry.targets[0]}  ${tickMarks(entry.targetTouches?.[0] ?? (entry.targetsHit[0] ? 1 : 0))}`} valueColor={entry.targetsHit[0] ? "var(--color-buy)" : undefined} />
          <DetailRow label="Target 2" value={`₹${entry.targets[1]}  ${tickMarks(entry.targetTouches?.[1] ?? (entry.targetsHit[1] ? 1 : 0))}`} valueColor={entry.targetsHit[1] ? "var(--color-buy)" : undefined} />
          <DetailRow label="Target 3" value={`₹${entry.targets[2]}  ${tickMarks(entry.targetTouches?.[2] ?? (entry.targetsHit[2] ? 1 : 0))}`} valueColor={entry.targetsHit[2] ? "var(--color-buy)" : undefined} />
          <DetailRow
            label="Stop Loss"
            value={effStop !== entry.stop ? `₹${effStop} (was ₹${entry.stop})` : `₹${entry.stop}`}
            valueColor="var(--color-sell)"
          />
        </div>

        <div className="mt-4 -mx-5">
          <PriceScale entry={entry} current={entry.closed ? exit : null} />
          <ProfitEstimate trade={entry} current={entry.closed ? exit : null} lotSize={LOT_SIZE[symbol]} />
        </div>

        {entry.meta?.reasons && entry.meta.reasons.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-2">Why this call</p>
            <div className="space-y-1.5">
              {entry.meta.reasons.map((r, i) => (
                <p key={i} className="text-sm flex items-start gap-2">
                  <ShieldCheck size={14} className="shrink-0 mt-0.5 text-[var(--color-primary)]" />
                  {r}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs font-bold uppercase text-[var(--color-muted)] mb-2 flex items-center gap-1.5">
            <CandlestickChart size={13} />
            Chart
          </p>
          <CallChart
            candles={candleData?.candles ?? []}
            entry={entry}
            loading={candlesLoading}
            errorReason={(candleData as { error?: string } | undefined)?.error ?? null}
          />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2 bg-[var(--color-surface-soft)]">
      <p className="text-[9px] text-[var(--color-muted)]">{label}</p>
      <p className="text-xs font-bold" style={{ color: color ?? "inherit" }}>
        {value}
      </p>
    </div>
  );
}

const REBOUND_STYLE: Record<ReboundTier, { bg: string; border: string; text: string }> = {
  strong: { bg: "#DCFCE7", border: "#86EFAC", text: "#15803D" },
  moderate: { bg: "#FEF3C7", border: "#FCD34D", text: "#B45309" },
  weak: { bg: "#FEE2E2", border: "#FCA5A5", text: "#B91C1C" },
};

const VOLUME_STYLE: Record<VolumeSupportTier, { bg: string; border: string; text: string }> = {
  strong: { bg: "#DCFCE7", border: "#86EFAC", text: "#15803D" },
  moderate: { bg: "#FEF3C7", border: "#FCD34D", text: "#B45309" },
  weak: { bg: "#FEE2E2", border: "#FCA5A5", text: "#B91C1C" },
};

// Always shown (unlike Rebound Strength, which only fires when underwater) --
// answers "is real buying/selling actually behind this move" every time the
// card is open, since that question matters whether the trade is comfortably
// in profit or not.
function VolumeSupportCard({ volume }: { volume: ReturnType<typeof checkVolumeSupport> }) {
  if (!volume) return null;
  const style = VOLUME_STYLE[volume.tier];
  return (
    <div className="mx-4 mb-3 rounded-xl px-3 py-2.5" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black" style={{ color: style.text }}>
          {volume.label}
        </p>
        <p className="text-[10px] font-bold" style={{ color: style.text }}>
          {volume.bias}x
        </p>
      </div>
      <p className="text-[10px] mt-1" style={{ color: style.text, opacity: 0.85 }}>
        {volume.note}
      </p>
    </div>
  );
}


// Shown only when the trade is currently underwater (premium between entry
// and stop) but hasn't been stopped out -- re-reads the underlying's own
// current indicators against the call's original direction so "does this
// still have strength to rebound to target?" has a real answer instead of
// being a guess.
function ReboundStrengthCard({ rebound }: { rebound: ReturnType<typeof checkReboundStrength> }) {
  if (!rebound) return null;
  const style = REBOUND_STYLE[rebound.tier];
  return (
    <div className="mx-4 mb-3 rounded-xl px-3 py-2.5" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black" style={{ color: style.text }}>
          {rebound.label}
        </p>
        <p className="text-[10px] font-bold" style={{ color: style.text }}>
          {rebound.score}% of checks favor it
        </p>
      </div>
      <p className="text-[9px] mt-1" style={{ color: style.text, opacity: 0.75 }}>
        Price is between entry and stop, still open — this re-checks the underlying's current indicators against this call's own direction.
      </p>
      <div className="mt-1.5 space-y-0.5">
        {rebound.reasons.map((r, i) => (
          <p key={i} className="text-[10px]" style={{ color: style.text }}>
            {r}
          </p>
        ))}
      </div>
    </div>
  );
}

// Answers "how close did this actually get before pulling back?" -- a
// question targetsHit/targetTouches can't, since those only fire at the
// exact target price. SL and Entry are frozen the moment the call opens
// (red/blue, never move); Peak is the highest live premium ever seen on
// this entry (green, only ever moves up, freezes once the trade closes);
// Now is wherever the live premium sits this instant (amber, only shown
// when the trade's still running and there's somewhere for it to differ
// from Peak).
function PriceScale({ entry, current }: { entry: TradeLogEntry; current?: number | null }) {
  const peak = Math.max(entry.highWaterMark ?? entry.entry, current ?? entry.entry, entry.entry);
  const values = [entry.stop, entry.entry, ...entry.targets, peak, ...(current !== null && current !== undefined ? [current] : [])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const showNow = current !== null && current !== undefined;
  const showPeak = peak > entry.entry + Math.max(0.01, entry.entry * 0.001);
  const pulledBack = showNow && showPeak && peak - current! > Math.max(0.01, entry.entry * 0.003);

  return (
    <div className="mx-4 mb-3 rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-1">Price Scale</p>
      <div className="mx-2.5">
        {/* Target labels sit in their own row above the bar -- 🎯1/🎯2/🎯3 at
            the exact same horizontal position their tick mark has below. */}
        <div className="relative h-4">
          {entry.targets.map((t, i) => (
            <span key={i} className="absolute -translate-x-1/2 text-[10px] font-bold whitespace-nowrap" style={{ left: `${pct(t)}%`, color: "var(--color-muted)" }}>
              🎯{i + 1}
            </span>
          ))}
        </div>
        {/* The live price floats ABOVE the bar with a blinking ring, on its
            own row, so it never visually merges with the Peak dot sitting
            on the bar right below it (they're often the exact same spot). */}
        {showNow && (
          <div className="relative h-6">
            <div className="absolute -translate-x-1/2 flex flex-col items-center" style={{ left: `${pct(current!)}%` }}>
              <span className="relative flex items-center justify-center w-4 h-4">
                <span className="absolute inline-flex w-full h-full rounded-full animate-ping" style={{ background: "#F59E0B", opacity: 0.6 }} />
                <span className="relative inline-flex w-2.5 h-2.5 rounded-full border-2 border-white" style={{ background: "#F59E0B", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
              </span>
              <span className="w-[2px] h-2" style={{ background: "#F59E0B" }} />
            </div>
          </div>
        )}
        <div className="relative h-2.5 rounded-full" style={{ background: "linear-gradient(90deg,#FCA5A5,#FDE68A,#86EFAC)" }}>
          {entry.targets.map((t, i) => (
            <div
              key={i}
              className="absolute top-1/2 w-[2px] h-3.5 -translate-y-1/2 -translate-x-1/2 bg-white/80 border-x border-[var(--color-border)]"
              style={{ left: `${pct(t)}%` }}
            />
          ))}
          <ScaleDot pct={pct(entry.stop)} color="#DC2626" label="SL" />
          <ScaleDot pct={pct(entry.entry)} color="#2563EB" label="B" />
          {showPeak && <ScaleDot pct={pct(peak)} color="#CA8A04" label="M" />}
        </div>
        {/* The peak's own rupee value, right under the M dot -- the legend
            row below already has it, but this is the number the "M" marker
            is actually pointing at, so it belongs right next to the dot
            itself rather than making someone look elsewhere for it. */}
        {showPeak && (
          <div className="relative h-4">
            <span className="absolute -translate-x-1/2 text-[10px] font-black whitespace-nowrap" style={{ left: `${pct(peak)}%`, color: "#CA8A04" }}>
              ₹{peak.toFixed(2)}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px]">
        <ScaleLegendItem color="#DC2626" label="SL" value={entry.stop} />
        <ScaleLegendItem color="#2563EB" label="Entry" value={entry.entry} />
        {showPeak && <ScaleLegendItem color="#CA8A04" label="Peak" value={peak} />}
        {showNow && <ScaleLegendItem color="#F59E0B" label="Now" value={current!} />}
      </div>
      {pulledBack && (
        <p className="text-[10px] mt-2 text-[var(--color-muted)]">
          Touched ₹{peak.toFixed(2)} at its best, now back to ₹{current!.toFixed(2)} — pulled back ₹{(peak - current!).toFixed(2)} from the peak.
        </p>
      )}
    </div>
  );
}

function ScaleDot({ pct, color, label }: { pct: number; color: string; label?: string }) {
  const wide = (label?.length ?? 0) > 1;
  return (
    <div
      className="absolute top-1/2 flex items-center justify-center rounded-full -translate-y-1/2 -translate-x-1/2 border-2 border-white"
      style={{
        left: `${pct}%`,
        background: color,
        zIndex: 2,
        boxShadow: "0 1px 3px rgba(0,0,0,.25)",
        width: wide ? 22 : label ? 16 : 14,
        height: label ? 16 : 14,
      }}
    >
      {label && (
        <span className="text-[7px] font-black leading-none text-white whitespace-nowrap" style={{ textShadow: "0 1px 1px rgba(0,0,0,.35)" }}>
          {label}
        </span>
      )}
    </div>
  );
}

function ScaleLegendItem({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1 font-semibold">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[var(--color-muted)]">{label}</span>
      <span>₹{value.toFixed(2)}</span>
    </span>
  );
}

const INR = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const PRESET_AMOUNTS = [50000, 100000, 200000, 500000];

// "If I put ~1 lakh into this, what am I actually sitting on right now" --
// the numbers everywhere else on the card are all in premium points, which
// don't by themselves say whether the live move is worth booking. Options
// only trade in whole lots, so this rounds DOWN to however many whole lots
// the amount actually buys (never fabricates a fractional lot), then prices
// that exact position at entry vs at the current/exit premium.
function ProfitEstimate({ trade, current, lotSize }: { trade: TradeLogEntry; current: number | null; lotSize: number }) {
  const [amount, setAmount] = useState(100000);
  if (current === null) return null;

  const costPerLot = trade.entry * lotSize;
  const lots = Math.floor(amount / costPerLot);
  const pnlPct = Number((((current - trade.entry) / trade.entry) * 100).toFixed(2));
  const inProfit = current >= trade.entry;

  return (
    <div className="mx-4 mb-3 rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[10px] font-bold uppercase text-[var(--color-muted)] mb-2.5 flex items-center gap-1.5">
        <Wallet size={12} />
        {trade.closed ? "What that investment would have made" : "What that investment is worth right now"}
      </p>

      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xs text-[var(--color-muted)]">₹</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm font-bold border"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESET_AMOUNTS.map((p) => (
          <button
            key={p}
            onClick={() => setAmount(p)}
            className="text-[10px] px-2 py-1 rounded-full font-bold"
            style={amount === p ? { background: "var(--color-primary)", color: "#fff" } : { background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            ₹{INR(p)}
          </button>
        ))}
      </div>

      {lots < 1 ? (
        <p className="text-xs text-[var(--color-muted)]">
          ₹{INR(amount)} isn't enough for even 1 lot at this entry — 1 lot of this call needs ₹{INR(costPerLot)} ({lotSize} qty × ₹{trade.entry}).
        </p>
      ) : (
        <>
          <p className="text-[11px] text-[var(--color-muted)] mb-2">
            Buys {lots} lot{lots > 1 ? "s" : ""} ({lots * lotSize} qty) for ₹{INR(lots * costPerLot)} at the ₹{trade.entry} entry.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--color-surface)" }}>
              <p className="text-[9px] text-[var(--color-muted)]">Invested</p>
              <p className="text-xs font-bold">₹{INR(lots * costPerLot)}</p>
            </div>
            <div className="rounded-lg px-2.5 py-2" style={{ background: "var(--color-surface)" }}>
              <p className="text-[9px] text-[var(--color-muted)]">{trade.closed ? "Exit value" : "Worth now"}</p>
              <p className="text-xs font-bold">₹{INR(lots * current * lotSize)}</p>
            </div>
          </div>
          <div className="mt-2 rounded-lg px-2.5 py-2 text-center" style={{ background: inProfit ? "#DCFCE7" : "#FEE2E2" }}>
            <p className="text-lg font-black" style={{ color: inProfit ? "#15803D" : "#B91C1C" }}>
              {inProfit ? "+" : ""}
              ₹{INR(lots * (current - trade.entry) * lotSize)}
            </p>
            <p className="text-[10px] font-semibold" style={{ color: inProfit ? "#15803D" : "#B91C1C" }}>
              {inProfit ? "+" : ""}
              {pnlPct}% {trade.closed ? "at exit" : "right now"}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function BestCallCard({
  symbol,
  data,
  tradeLogs,
  loggedKey,
  setLoggedKey,
  copiedKey,
  setCopiedKey,
  createTrade,
}: {
  symbol: TradableSymbol;
  data: ReturnType<typeof useBestCallForSymbol>;
  tradeLogs: Record<string, TradeLogEntry[]>;
  loggedKey: string | null;
  setLoggedKey: (k: string | null) => void;
  copiedKey: string | null;
  setCopiedKey: (k: string | null) => void;
  createTrade: ReturnType<typeof useCreateTrade>;
}) {
  // `data.best` is only ever the CURRENT poll's live re-scan -- a
  // candlestick/setup match is momentary by nature, so it can legitimately
  // go null on a later poll even while the trade it opened is still running.
  // The tracked entry itself (latest) is the source of truth for what's
  // actually open; its own meta (captured at the moment it opened) covers
  // source/reasons when the live pick has since gone quiet. Confidence/R:R
  // aren't persisted in meta, so those badges simply hide once best is null.
  const forceCloseTradeLog = useAppStore((s) => s.forceCloseTradeLog);
  const [chatOpen, setChatOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const best = data.best;
  const log = tradeLogs[data.trackingKey] ?? [];
  const latest = log[log.length - 1];
  if (!latest) return null;
  const effStop = effectiveStopFor(latest);
  const handleForceStop = () => {
    const pw = window.prompt("Enter password to force-stop this trade:");
    if (pw === null) return;
    if (pw !== FORCE_STOP_PASSWORD) {
      window.alert("Incorrect password.");
      return;
    }
    if (window.confirm("Mark this trade as completed now? This can't be undone.")) {
      forceCloseTradeLog(data.trackingKey);
    }
  };

  // `best` is this poll's fresh, independent re-scan across ALL three
  // engines -- it can currently be reporting a totally different qualifying
  // setup (different strike, different direction, different source engine)
  // than the one actually open and tracked here. Only trust it for
  // display when it genuinely IS the same instance (matching strike +
  // side); otherwise every number below must come from the tracked entry
  // itself, or a live re-scan match for an unrelated setup can silently
  // relabel an open CE as bearish/"Directional Gate" just because that
  // engine happens to be qualifying something else on this symbol right now.
  const sameInstance = best !== null && best.strike === latest.strike && best.optSide === latest.optSide;
  const source = ((sameInstance ? best.source : undefined) ?? (latest.meta?.label as BestCallSource | undefined) ?? "AI Elite") as BestCallSource;
  const direction: "bullish" | "bearish" = latest.optSide === "CE" ? "bullish" : "bearish";
  const liveLtp = !latest.closed ? liveLtpFor(data.options, latest.strike, latest.optSide) : null;
  // Underwater but not stopped out -- premium has pulled back below entry
  // without reaching the stop yet. This is exactly the moment "should I
  // still hold this?" matters most and there's normally no signal to answer
  // it, so re-check the underlying's current technical strength against the
  // call's own original direction rather than leaving it a guess.
  const inBetween = !latest.closed && liveLtp !== null && liveLtp < latest.entry && liveLtp > effStop;
  const rebound = inBetween ? checkReboundStrength(data.underlyingCandles, direction) : null;
  const volumeSupport = !latest.closed ? checkVolumeSupport(data.underlyingCandles, direction) : null;
  const nextTarget = latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0];
  const legFloor = latest.targetsHit[1] ? latest.targets[1] : latest.targetsHit[0] ? latest.targets[0] : latest.entry;
  const potential = calculatePotentialLeft(latest.entry, latest.stop, nextTarget, liveLtp ?? latest.entry);
  const entryTiming = !latest.closed && liveLtp !== null ? evaluateEntryTiming(legFloor, nextTarget, effStop, liveLtp) : null;
  const Bias = direction === "bullish" ? TrendingUp : TrendingDown;
  const biasColor = direction === "bullish" ? "var(--color-buy)" : "var(--color-sell)";

  const tip = formatTipCard({
    symbolLabel: DISPLAY_NAME[symbol],
    strike: latest.strike,
    optSide: latest.optSide,
    expiryLabel: formatExpiryTip(data.expiry),
    buyZoneLow: latest.entry,
    buyZoneHigh: Number((latest.entry * 1.02).toFixed(2)),
    targets: latest.targets,
    stopLoss: effStop,
  });

  return (
    <div className="card overflow-hidden" style={{ border: `2px solid ${SOURCE_COLOR[source]}` }}>
      <div className="flex items-center justify-between px-4 pt-3.5 text-[11px] text-[var(--color-muted)]">
        <span>
          Created on: {new Date(latest.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase()} at ₹{latest.entry}
        </span>
        <span className="flex items-center gap-1 font-bold" style={{ color: SOURCE_COLOR[source] }}>
          <Info size={12} />
          {source}
        </span>
      </div>

      <div className="px-4 pt-3 flex items-center justify-between">
        <div>
          <p className="text-lg font-black flex items-center gap-1.5">
            <Bias size={16} style={{ color: biasColor }} />
            {DISPLAY_NAME[symbol].toUpperCase()} {latest.strike} {latest.optSide}
          </p>
          <p className="text-xs text-[var(--color-muted)]">{formatExpiryTip(data.expiry)} expiry</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-black" style={{ color: biasColor }}>
            ₹{liveLtp ?? latest.entry}
          </p>
          <p className="text-[10px] text-[var(--color-muted)]">Current premium</p>
          {entryTiming && <EntryTimingBadge verdict={entryTiming} className="mt-1 max-w-[160px]" />}
        </div>
      </div>

      <pre className="mx-4 mt-3 rounded-xl bg-[var(--color-surface-soft)] px-3.5 py-3 text-[13px] leading-6 whitespace-pre-wrap font-sans">{tip}</pre>

      <div className="px-4 mt-2 flex items-center gap-2 flex-wrap">
        {sameInstance && <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">Confidence {Math.round(best!.confidence)}%</span>}
        {sameInstance && best!.rr != null && <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">R:R 1:{best!.rr}</span>}
        {!latest.closed && (
          <span className="text-[10px] px-2 py-1 rounded-full font-bold animate-pulse" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
            LIVE
          </span>
        )}
      </div>

      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-[var(--color-buy)]">▲▲</span>
            <div>
              <p className="text-sm font-black text-[var(--color-buy)]">{potential.potentialLeftPercent}%</p>
              <p className="text-[10px] text-[var(--color-muted)]">Potential left</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(tip);
                setCopiedKey(data.trackingKey);
                setTimeout(() => setCopiedKey(null), 2000);
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-[var(--color-surface-soft)]"
            >
              <Copy size={13} />
              {copiedKey === data.trackingKey ? "Copied ✓" : "Copy"}
            </button>
            {!latest.closed && (
              <button
                disabled={loggedKey === data.trackingKey}
                onClick={() =>
                  createTrade.mutate(
                    {
                      symbol,
                      optSide: latest.optSide,
                      strike: latest.strike,
                      entryPrice: latest.entry,
                      stopLoss: latest.stop,
                      target: latest.targets[0],
                      quantity: 1,
                      lotSize: LOT_SIZE[symbol],
                      source: "master-ai",
                      notes: `Logged from Best Call (${source})`,
                    },
                    { onSuccess: () => setLoggedKey(data.trackingKey) }
                  )
                }
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                style={{ background: biasColor }}
              >
                {loggedKey === data.trackingKey ? "Logged ✓" : "Buy"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pb-3 -mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-muted)]">
        <span className={latest.targetsHit[0] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(latest.targetTouches?.[0] ?? (latest.targetsHit[0] ? 1 : 0))} T1 ₹{latest.targets[0]}
        </span>
        <span className={latest.targetsHit[1] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(latest.targetTouches?.[1] ?? (latest.targetsHit[1] ? 1 : 0))} T2 ₹{latest.targets[1]}
        </span>
        <span className={latest.targetsHit[2] ? "text-[var(--color-buy)] font-semibold" : ""}>
          {tickMarks(latest.targetTouches?.[2] ?? (latest.targetsHit[2] ? 1 : 0))} T3 ₹{latest.targets[2]}
        </span>
        <span>
          SL ₹{effStop}
          {effStop !== latest.stop && <span className="opacity-60"> (was ₹{latest.stop})</span>}
        </span>
      </div>
      <PriceScale entry={latest} current={latest.closed ? null : liveLtp} />
      <ProfitEstimate trade={latest} current={latest.closed ? null : liveLtp} lotSize={LOT_SIZE[symbol]} />
      {rebound && <ReboundStrengthCard rebound={rebound} />}
      <VolumeSupportCard volume={volumeSupport} />
      {!latest.closed && (
        <div className="px-4 pb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] text-[var(--color-muted)]">Next target ₹{nextTarget}</p>
          <button onClick={handleForceStop} className="flex items-center gap-1 text-[10px] font-bold text-[var(--color-muted)] underline underline-offset-2 shrink-0">
            <Lock size={10} />
            Force Stop
          </button>
        </div>
      )}
      {latest.closed && (
        <p className="px-4 pb-3.5 text-[11px] font-bold" style={{ color: exitPriceFor(latest) - latest.entry >= 0 ? "var(--color-buy)" : "var(--color-sell)" }}>
          Closed: {latest.status.replace(/_/g, " ")}
        </p>
      )}

      <div className="px-4 pb-4">
        <button
          onClick={() => setChartOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border mb-2"
          style={{ background: "var(--color-surface-soft)", borderColor: "var(--color-border)", color: "var(--color-primary)" }}
        >
          <CandlestickChart size={14} />
          View Chart
          <ChevronDown size={14} className={`transition-transform ${chartOpen ? "rotate-180" : ""}`} />
        </button>
        {chartOpen && (
          <div className="mb-2 rounded-xl p-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
            <CallChart
              candles={data.underlyingCandles}
              entry={latest}
              loading={data.underlyingCandlesLoading}
              errorReason={data.underlyingCandlesError}
            />
          </div>
        )}
        <button
          onClick={() => setChatOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold border"
          style={{ background: "var(--color-surface-soft)", borderColor: "var(--color-border)", color: "var(--color-primary)" }}
        >
          <MessageCircle size={14} />
          Chat about this call
          <ChevronDown size={14} className={`transition-transform ${chatOpen ? "rotate-180" : ""}`} />
        </button>
        {chatOpen && (
          <div className="mt-2 rounded-xl p-3 space-y-3" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
            <p className="text-[9px] text-[var(--color-muted)]">Answers below are built from this call's own real numbers — not a free-text chat model.</p>
            <ChatBubble
              q="Why was this call made?"
              a={
                latest.meta
                  ? `${latest.meta.label} picked this: ${latest.meta.reasons[0] ?? "multiple confirming factors agreed on this direction."}${
                      latest.meta.confirmingTimeframes.length ? ` Confirmed by: ${latest.meta.confirmingTimeframes.join(", ")}.` : ""
                    }`
                  : "This call was opened before detailed reasoning capture shipped, so the original notes weren't saved for it — only the numbers below are available."
              }
            />
            <ChatBubble
              q="What's happening right now?"
              a={
                latest.closed
                  ? `Closed: ${latest.status.replace(/_/g, " ")} at ₹${exitPriceFor(latest)}, ${exitPriceFor(latest) - latest.entry >= 0 ? "a gain" : "a loss"} of ${Math.abs(Number((exitPriceFor(latest) - latest.entry).toFixed(2)))} points from the ₹${latest.entry} entry.`
                  : `Current premium ₹${liveLtp ?? latest.entry} vs entry ₹${latest.entry} -- ${potential.potentialLeftPercent}% of the move to the next target (₹${nextTarget}) is still left to capture.${
                      rebound ? ` Rebound check: ${rebound.label} (${rebound.score}% of checks still favor the original direction).` : ""
                    }`
              }
            />
            <ChatBubble
              q="What if the target fails?"
              a={
                latest.targetsHit[0]
                  ? `Target 1 was already reached, so the stop has already trailed up to ₹${effStop}${latest.targetsHit[1] ? " (locking the Target 1-2 gain)" : " (breakeven)"} -- it won't wait for the original ₹${latest.stop} anymore.`
                  : `It hasn't reached Target 1 yet, so the original stop loss ₹${latest.stop} still applies.`
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-xs font-bold" style={{ color: "var(--color-primary)" }}>
        {q}
      </p>
      <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{a}</p>
    </div>
  );
}
