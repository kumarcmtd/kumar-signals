import { useState } from "react";
import { Wallet } from "lucide-react";
import type { TradeLogEntry } from "../store/appStore";
import type { ReboundCheck, ReboundTier } from "../utils/reboundStrength";
import type { VolumeSupportCheck, VolumeSupportTier } from "../utils/volumeSupport";
import { TradeChart, type ChartMarkerSpec } from "./TradeChart";
import type { Candle } from "../types";

// Shared display building blocks originally built for Best Call, now reused
// verbatim by every other live-call page (Ai20-20 and onward) so "one call
// card, wherever it appears" stays visually and behaviorally identical
// instead of drifting into N slightly-different reimplementations.

// 0 touches -> a plain unfilled circle; 1-3 -> that many ticks; 4+ -> a
// single tick with a count, so a target that keeps getting re-tested doesn't
// blow out the row width.
export function tickMarks(count: number): string {
  if (count <= 0) return "○";
  if (count <= 3) return "✓".repeat(count);
  return `✓×${count}`;
}

export function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatExpiryTip(expiry: string | undefined): string {
  if (!expiry) return "—";
  try {
    return new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return expiry;
  }
}

export function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--color-border)] last:border-0">
      <span className="text-sm text-[var(--color-muted)]">{label}</span>
      <span className="text-base font-bold" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

// Marks the exact candle the call opened in (and closed in, if it's done) on
// the UNDERLYING's own price chart. Entry/target/stop are option-PREMIUM
// levels, not underlying price levels, so they're deliberately not drawn as
// horizontal lines here (that would put a small premium's lines on a much
// larger futures-price scale) -- this chart exists purely to let a person
// visually re-check what the underlying was actually doing at and after the
// moment this call fired, same market data the engines themselves scanned.
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

export function CallChart({
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
  const markers = callChartMarkers(entry);
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
        Underlying price action, not the option premium — the marked candle is exactly when this call was called
        {entry.closed ? " and closed" : ""}. Targets/SL are premium levels (see the numbers above), so they aren't drawn on this price scale.
      </p>
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

// Answers "how close did this actually get before pulling back?" -- a
// question targetsHit/targetTouches can't, since those only fire at the
// exact target price. SL and Entry are frozen the moment the call opens
// (red/blue, never move); Peak is the highest live premium ever seen on
// this entry (green, only ever moves up, freezes once the trade closes);
// Now is wherever the live premium sits this instant (amber, only shown
// when the trade's still running and there's somewhere for it to differ
// from Peak).
export function PriceScale({ entry, current }: { entry: TradeLogEntry; current?: number | null }) {
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

const INR = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const PRESET_AMOUNTS = [50000, 100000, 200000, 500000];

// "If I put ~1 lakh into this, what am I actually sitting on right now" --
// the numbers everywhere else on the card are all in premium points, which
// don't by themselves say whether the live move is worth booking. Options
// only trade in whole lots, so this rounds DOWN to however many whole lots
// the amount actually buys (never fabricates a fractional lot), then prices
// that exact position at entry vs at the current/exit premium.
export function ProfitEstimate({ trade, current, lotSize }: { trade: TradeLogEntry; current: number | null; lotSize: number }) {
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
export function VolumeSupportCard({ volume }: { volume: VolumeSupportCheck | null }) {
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
export function ReboundStrengthCard({ rebound }: { rebound: ReboundCheck | null }) {
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

export function ChatBubble({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="text-xs font-bold" style={{ color: "var(--color-primary)" }}>
        {q}
      </p>
      <p className="text-[11px] text-[var(--color-muted)] mt-0.5">{a}</p>
    </div>
  );
}
