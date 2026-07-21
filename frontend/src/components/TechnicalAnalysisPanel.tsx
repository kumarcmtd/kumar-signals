import { useMemo, type ReactNode } from "react";
import { computeIndicatorSnapshot } from "../utils/indicators";
import type { Candle } from "../types";

const dirColor: Record<string, string> = {
  bullish: "text-[var(--color-buy)]",
  bearish: "text-[var(--color-sell)]",
  neutral: "text-[var(--color-muted)]",
};
const dirBg: Record<string, string> = {
  bullish: "bg-[var(--color-buy-soft)]",
  bearish: "bg-[var(--color-sell-soft)]",
  neutral: "bg-slate-100",
};

function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function TechnicalAnalysisPanel({ candles }: { candles: Candle[] }) {
  const snap = useMemo(() => computeIndicatorSnapshot(candles), [candles]);

  if (candles.length < 15) {
    return (
      <div className="card p-4 text-sm text-[var(--color-muted)]">
        Not enough bars yet to compute indicators at this timeframe.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className={`card p-4 flex items-center justify-between ${dirBg[snap.trendDirection]}`}>
        <div>
          <p className="text-[11px] text-black/50 font-bold uppercase">Trend Direction</p>
          <p className={`text-lg font-black ${dirColor[snap.trendDirection]}`}>{snap.trendDirection.toUpperCase()}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-black/50 font-bold uppercase">Momentum Score</p>
          <p className="text-lg font-black">{snap.momentumScore ?? "—"}</p>
        </div>
      </div>

      <Section title="Moving Averages">
        <Grid4>
          <Tile label="EMA 9" value={fmt(snap.ema9)} />
          <Tile label="EMA 20" value={fmt(snap.ema20)} />
          <Tile label="EMA 50" value={fmt(snap.ema50)} />
          <Tile label="EMA 200" value={fmt(snap.ema200)} />
        </Grid4>
      </Section>

      <Section title="Momentum & Volatility">
        <Grid4>
          <Tile label="RSI (14)" value={fmt(snap.rsi14, 1)} accent={snap.rsi14 !== null ? (snap.rsi14 > 70 ? "sell" : snap.rsi14 < 30 ? "buy" : undefined) : undefined} />
          <Tile label="ADX (14)" value={fmt(snap.adx14, 1)} />
          <Tile label="ATR (14)" value={fmt(snap.atr14)} />
          <Tile label="VWAP" value={fmt(snap.vwap)} />
        </Grid4>
      </Section>

      <Section title="MACD (12,26,9)">
        <Grid4>
          <Tile label="Line" value={fmt(snap.macd?.line ?? null)} />
          <Tile label="Signal" value={fmt(snap.macd?.signal ?? null)} />
          <Tile
            label="Histogram"
            value={fmt(snap.macd?.histogram ?? null)}
            accent={snap.macd ? (snap.macd.histogram >= 0 ? "buy" : "sell") : undefined}
          />
          <Tile
            label="SuperTrend"
            value={fmt(snap.superTrend?.value ?? null)}
            accent={snap.superTrend ? (snap.superTrend.direction === "bullish" ? "buy" : "sell") : undefined}
          />
        </Grid4>
      </Section>

      <Section title="Bollinger Bands (20, 2σ)">
        <Grid4>
          <Tile label="Upper" value={fmt(snap.bollinger?.upper ?? null)} />
          <Tile label="Middle" value={fmt(snap.bollinger?.middle ?? null)} />
          <Tile label="Lower" value={fmt(snap.bollinger?.lower ?? null)} />
        </Grid4>
      </Section>

      <Section title="Pivot Points">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="R3" value={fmt(snap.pivots?.r3 ?? null)} accent="sell" />
          <Tile label="R2" value={fmt(snap.pivots?.r2 ?? null)} accent="sell" />
          <Tile label="R1" value={fmt(snap.pivots?.r1 ?? null)} accent="sell" />
          <Tile label="Pivot" value={fmt(snap.pivots?.pivot ?? null)} className="col-span-3" />
          <Tile label="S1" value={fmt(snap.pivots?.s1 ?? null)} accent="buy" />
          <Tile label="S2" value={fmt(snap.pivots?.s2 ?? null)} accent="buy" />
          <Tile label="S3" value={fmt(snap.pivots?.s3 ?? null)} accent="buy" />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)] mb-2 px-1">{title}</p>
      {children}
    </div>
  );
}

function Grid4({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function Tile({
  label,
  value,
  accent,
  className = "",
}: {
  label: string;
  value: string;
  accent?: "buy" | "sell";
  className?: string;
}) {
  const accentClass =
    accent === "buy" ? "bg-[var(--color-buy-soft)] text-emerald-700" : accent === "sell" ? "bg-[var(--color-sell-soft)] text-rose-700" : "bg-[var(--color-surface-soft)]";
  return (
    <div className={`rounded-xl px-3 py-2 ${accentClass} ${className}`}>
      <p className="text-[11px] opacity-60">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
