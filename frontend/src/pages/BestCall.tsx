import { useMemo, useState } from "react";
import { Copy, Info, ShieldCheck, TrendingUp, TrendingDown } from "lucide-react";
import { useCreateTrade, usePortfolio } from "../api/hooks";
import { useBestCallForSymbol, type TradableSymbol } from "../hooks/useBestCall";
import { liveLtpFor } from "../hooks/useTradeLog";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { calculatePotentialLeft } from "../utils/kimiPlaybook";
import { formatTipCard } from "../utils/tipFormat";
import { flattenClosedTrades, computePerformanceStats, exitPriceFor } from "../utils/tradeLogPnl";
import { summarizeTradeLogsByDay } from "../utils/tradeLogStats";
import { type BestCallPick, type BestCallSource } from "../utils/bestCallSelector";

const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SOURCE_COLOR: Record<BestCallSource, string> = { "AI Elite": "#7C3AED", "Directional Gate": "#0891B2", "Kimi Playbook": "#B45309", "Pattern Signal": "#0D9488" };

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

export function BestCall() {
  const { data: trades } = usePortfolio();
  const createTrade = useCreateTrade();
  const [loggedKey, setLoggedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
  const realized = useMemo(() => flattenClosedTrades(bestTradeLogsOnly), [bestTradeLogsOnly]);
  const perf = useMemo(() => computePerformanceStats(realized), [realized]);
  const dayStats = useMemo(() => summarizeTradeLogsByDay(bestTradeLogsOnly), [bestTradeLogsOnly]);

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
    const out: { symbol: TradableSymbol; entry: TradeLogEntry }[] = [];
    for (const [k, v] of Object.entries(bestTradeLogsOnly)) {
      const symbol = k.replace("BEST-", "") as TradableSymbol;
      for (const entry of v) out.push({ symbol, entry });
    }
    return out.sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  }, [bestTradeLogsOnly]);

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
            {allCalls.map(({ symbol, entry }) => (
              <CallHistoryRow key={entry.id} symbol={symbol} entry={entry} />
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
    </div>
  );
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CallHistoryRow({ symbol, entry }: { symbol: TradableSymbol; entry: TradeLogEntry }) {
  const exit = entry.closed ? exitPriceFor(entry) : null;
  const pnl = exit !== null ? Number((exit - entry.entry).toFixed(2)) : null;
  const statusLabel = entry.closed ? entry.status.replace(/_/g, " ") : "Running";
  const statusColor = !entry.closed ? "#B45309" : pnl !== null && pnl > 0 ? "var(--color-buy)" : pnl !== null && pnl < 0 ? "var(--color-sell)" : "#B45309";

  return (
    <div className="rounded-xl border border-[var(--color-border)] px-3 py-2.5">
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
        </div>
        <div className="text-right shrink-0">
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
        <span>SL ₹{entry.stop}</span>
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
  const best = data.best;
  const log = tradeLogs[data.trackingKey] ?? [];
  const latest = log[log.length - 1];
  if (!latest) return null;

  const source = (best?.source ?? (latest.meta?.label as BestCallSource | undefined) ?? "AI Elite") as BestCallSource;
  const direction = best?.direction ?? (latest.optSide === "CE" ? "bullish" : "bearish");
  const liveLtp = !latest.closed ? liveLtpFor(data.options, latest.strike, latest.optSide) : null;
  const nextTarget = latest.targetsHit[1] ? latest.targets[2] : latest.targetsHit[0] ? latest.targets[1] : latest.targets[0];
  const potential = calculatePotentialLeft(latest.entry, latest.stop, nextTarget, liveLtp ?? latest.entry);
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
    stopLoss: latest.stop,
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5 text-[11px] text-[var(--color-muted)]">
        <span>Created on: {new Date(latest.openedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).toUpperCase()}</span>
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
        </div>
      </div>

      <pre className="mx-4 mt-3 rounded-xl bg-[var(--color-surface-soft)] px-3.5 py-3 text-[13px] leading-6 whitespace-pre-wrap font-sans">{tip}</pre>

      <div className="px-4 mt-2 flex items-center gap-2 flex-wrap">
        {best && <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">Confidence {Math.round(best.confidence)}%</span>}
        {best?.rr != null && <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-[var(--color-surface-soft)]">R:R 1:{best.rr}</span>}
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
        <span>SL ₹{latest.stop}</span>
      </div>
      {!latest.closed && (
        <p className="px-4 pb-3 text-[10px] text-[var(--color-muted)]">Next target ₹{nextTarget}</p>
      )}
      {latest.closed && (
        <p className="px-4 pb-3.5 text-[11px] font-bold" style={{ color: exitPriceFor(latest) - latest.entry >= 0 ? "var(--color-buy)" : "var(--color-sell)" }}>
          Closed: {latest.status.replace(/_/g, " ")}
        </p>
      )}
    </div>
  );
}
