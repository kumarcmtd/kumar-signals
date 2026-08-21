import { Gauge as GaugeIcon } from "lucide-react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { computePriceSpeed } from "../utils/priceSpeed";
import type { InstrumentSymbol } from "../types";

const DISPLAY_NAME: Partial<Record<InstrumentSymbol, string>> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const SIZE = 168;
const HEIGHT = SIZE * 0.72;
const CX = SIZE / 2;
const CY = HEIGHT * 0.92;
const R = SIZE * 0.42;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

// 180deg = left end (score 0), 90deg = top (score 50), 0deg = right end
// (score 100) -- standard math angles, y flipped since SVG y grows downward.
function arcPath(scoreFrom: number, scoreTo: number): string {
  const a0 = 180 - (scoreFrom / 100) * 180;
  const a1 = 180 - (scoreTo / 100) * 180;
  const p0 = polar(CX, CY, R, a0);
  const p1 = polar(CX, CY, R, a1);
  const largeArc = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${R} ${R} 0 ${largeArc} 0 ${p1.x} ${p1.y}`;
}

// Matches the bands computePriceSpeed itself scores against (see
// priceSpeed.ts) -- Calm/Normal/Volatile/Extreme, so the needle always
// lands inside the zone whose color it's already been assigned.
const BANDS: { from: number; to: number; color: string }[] = [
  { from: 0, to: 30, color: "#0EA5E9" },
  { from: 30, to: 55, color: "#16A34A" },
  { from: 55, to: 75, color: "#EA580C" },
  { from: 75, to: 100, color: "#DC2626" },
];

function SpeedGauge({ score, color, label }: { score: number; color: string; label: string }) {
  const rotation = score * 1.8 - 90;
  const strokeW = SIZE * 0.085;
  return (
    <div className="flex flex-col items-center" style={{ width: SIZE }}>
      <svg width={SIZE} height={HEIGHT} viewBox={`0 0 ${SIZE} ${HEIGHT}`}>
        {BANDS.map((b) => (
          <path key={b.color} d={arcPath(b.from, b.to)} stroke={b.color} strokeWidth={strokeW} fill="none" opacity={0.3} />
        ))}
        <g style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${rotation}deg)`, transition: "transform 0.7s cubic-bezier(.34,1.4,.64,1)" }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R * 0.84} stroke={color} strokeWidth={3} strokeLinecap="round" />
        </g>
        <circle cx={CX} cy={CY} r={5} fill={color} />
      </svg>
      {/* Below the gauge, not overlaid on it -- the needle can point fully
          horizontal at either extreme (score 0 or 100), which would cut
          straight through any readout placed on top of the arc's bowl. */}
      <div className="flex flex-col items-center -mt-1">
        <span className="text-xl font-black leading-none" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] font-black uppercase tracking-wide leading-tight" style={{ color }}>
          {label}
        </span>
      </div>
    </div>
  );
}

// Self-contained like NewsImpactCard -- fetches its own 15m candles and
// options analytics, so it drops into any page with just a symbol prop and
// never depends on that page's own hook wiring. "How fast is this moving
// RIGHT NOW" relative to this exact instrument's own recent pace (see
// computePriceSpeed's self-calibrating ratio), not a fixed rupee cutoff
// that would mean something different for Crude Oil vs Natural Gas.
export function VolatilityMeter({ symbol, variant = "light" }: { symbol: InstrumentSymbol; variant?: "light" | "dark" }) {
  const { data: candleData } = useCandles(symbol, "15");
  const { data: options } = useOptionsAnalytics(symbol);

  const atmDelta = options?.atmStrike != null ? (options.rows.find((r) => r.strike === options.atmStrike)?.call.delta ?? null) : null;
  const reading = candleData?.candles?.length ? computePriceSpeed(candleData.candles, atmDelta) : null;

  const dark = variant === "dark";

  if (!reading) {
    return (
      <div className={`rounded-2xl p-3 text-center ${dark ? "" : "bg-slate-50 border border-slate-100"}`} style={dark ? { background: "#181A24", border: "1px solid rgba(255,255,255,.08)" } : undefined}>
        <p className={`text-[10px] ${dark ? "text-white/40" : "text-slate-400"}`}>Gathering recent candles to gauge how fast price is moving…</p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl p-3.5 ${dark ? "" : "bg-white border border-slate-100 shadow-sm"}`} style={dark ? { background: "#181A24", border: "1px solid rgba(255,255,255,.08)" } : undefined}>
      <p className={`text-[10px] font-bold uppercase flex items-center gap-1.5 mb-1 ${dark ? "text-white/50" : "text-slate-500"}`}>
        <GaugeIcon size={12} /> {DISPLAY_NAME[symbol] ?? symbol} Speed (15m)
      </p>
      <div className="flex items-center justify-center">
        <SpeedGauge score={reading.score} color={reading.color} label={reading.label} />
      </div>
      <div className={`flex justify-between text-[9px] px-3 mt-1 ${dark ? "text-white/30" : "text-slate-400"}`}>
        <span>Calm</span>
        <span>Extreme</span>
      </div>
      <div className={`grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px] ${dark ? "text-white/50" : "text-slate-500"}`}>
        <span>
          ATR (14): <b className={dark ? "text-white/80" : "text-slate-700"}>₹{reading.atrValue}</b> ({reading.atrPct}%)
        </span>
        <span>
          Last candle range: <b className={dark ? "text-white/80" : "text-slate-700"}>₹{reading.lastRange}</b>
        </span>
        {reading.estPremiumSwing !== null && (
          <span className="col-span-2">
            Est. premium swing/candle: <b className={dark ? "text-white/80" : "text-slate-700"}>±₹{reading.estPremiumSwing}</b> (ATM delta-based estimate)
          </span>
        )}
      </div>
    </div>
  );
}
