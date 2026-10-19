// The AI chart: candles + volume with everything the call is built on drawn
// in -- buyer (green) and seller (red) zones, unfilled FVG gaps, the trend
// channel, pivot / previous-day levels, the call's entry / stop / targets, and
// a dashed arrow for the PLANNED path (pullback to the zone, then targets).
// Hand-drawn SVG so zones, channels and arrows can be drawn exactly; it reads
// the same candles and the same zone finder as the Trade Card.

import { useMemo, useState } from "react";
import { useCandles } from "../../api/hooks";
import { findZones } from "../../utils/zones";
import { findFvgs, plannedPath, trendChannel } from "../../utils/chartMarks";
import type { KeyLevels } from "../../utils/checklist";
import type { Candle } from "../../types";

export interface ChartPlan {
  side: "CE" | "PE";
  entry: number | null;
  stop: number | null;
  t1: number | null;
  t2: number | null;
  zone: { low: number; high: number } | null; // waiting for a pullback here
  label: string;
}

const W = 360;
const PLOT_W = 312;
const P_TOP = 10;
const P_H = 206;
const V_TOP = 222;
const V_H = 40;
const H = 286;
const FUTURE = 20;
const istHM = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(11, 16);
const istD = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(8, 10);

function Chart({ candles, plan, levels }: { candles: Candle[]; plan: ChartPlan | null; levels: KeyLevels | null }) {
  const n = candles.length;
  const last = candles[n - 1];
  const zones = useMemo(() => findZones(candles, last.close), [candles, last.close]);
  const fvgs = useMemo(() => findFvgs(candles), [candles]);
  const ch = useMemo(() => trendChannel(candles), [candles]);

  let lo = Math.min(...candles.map((c) => c.low));
  let hi = Math.max(...candles.map((c) => c.high));
  const span0 = hi - lo || 1;
  for (const p of [plan?.entry, plan?.stop, plan?.t1, plan?.t2, plan?.zone?.low, plan?.zone?.high]) {
    if (p == null) continue;
    lo = Math.min(lo, Math.max(p, lo - span0 * 0.6));
    hi = Math.max(hi, Math.min(p, hi + span0 * 0.6));
  }
  const pad = (hi - lo) * 0.05;
  lo -= pad;
  hi += pad;
  const slots = n + FUTURE;
  const cw = PLOT_W / slots;
  const x = (i: number) => i * cw + cw / 2;
  const y = (p: number) => P_TOP + ((hi - p) / (hi - lo)) * P_H;
  const inRange = (p: number) => p >= lo && p <= hi;
  const maxVol = Math.max(1, ...candles.map((c) => c.volume ?? 0));
  const ticks = Array.from({ length: 5 }, (_, k) => lo + ((hi - lo) * (k + 0.5)) / 5);
  const dec = last.close < 1000 ? 2 : 0;

  const zoneRect = (lowP: number, highP: number, fromX: number, fill: string, stroke: string, label: string) => {
    if (highP < lo || lowP > hi) return null;
    const top = y(Math.min(highP, hi));
    const bot = y(Math.max(lowP, lo));
    return (
      <g>
        <rect x={fromX} y={top} width={PLOT_W - fromX} height={Math.max(2, bot - top)} fill={fill} stroke={stroke} strokeWidth={0.6} />
        <text x={fromX + 3} y={top + 8} fontSize={7} fontWeight={800} fill={stroke}>
          {label}
        </text>
      </g>
    );
  };
  const hLine = (p: number | null | undefined, color: string, label: string, dash?: string, bold?: boolean) =>
    p == null || !inRange(p) ? null : (
      <g key={label}>
        <line x1={0} x2={PLOT_W} y1={y(p)} y2={y(p)} stroke={color} strokeWidth={bold ? 1.3 : 0.7} strokeDasharray={dash} />
        <rect x={PLOT_W + 1} y={y(p) - 6} width={W - PLOT_W - 1} height={12} rx={2} fill={color} />
        <text x={PLOT_W + 3} y={y(p) + 3} fontSize={7} fontWeight={800} fill="#fff">
          {label} {p.toFixed(dec)}
        </text>
      </g>
    );

  const path = plan && plan.t1 != null ? plannedPath(plan.side, last.close, plan.t1, plan.t2, plan.zone) : null;
  const up = plan?.side === "CE";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl" style={{ background: "#F8FAFC" }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#0F766E" />
        </marker>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={PLOT_W} y1={y(t)} y2={y(t)} stroke="#E2E8F0" strokeWidth={0.5} />
          <text x={PLOT_W + 3} y={y(t) + 3} fontSize={7} fill="#64748B">
            {t.toFixed(dec)}
          </text>
        </g>
      ))}
      {/* zones and gaps first, under the candles */}
      {zones?.buyer.slice(0, 2).map((z, i) => <g key={`b${i}`}>{zoneRect(z.low, z.high, 0, "rgba(16,185,129,.16)", "#059669", `BUYERS ${z.at}`)}</g>)}
      {zones?.seller.slice(0, 2).map((z, i) => <g key={`s${i}`}>{zoneRect(z.low, z.high, 0, "rgba(244,63,94,.16)", "#E11D48", `SELLERS ${z.at}`)}</g>)}
      {fvgs.map((f, i) => <g key={`f${i}`}>{zoneRect(f.low, f.high, x(f.index), f.kind === "bull" ? "rgba(99,102,241,.14)" : "rgba(234,88,12,.14)", f.kind === "bull" ? "#4F46E5" : "#EA580C", `FVG ${f.kind === "bull" ? "▲" : "▼"}`)}</g>)}
      {plan?.zone && zoneRect(plan.zone.low, plan.zone.high, x(n - 1), "rgba(250,204,21,.28)", "#A16207", "WAIT HERE")}
      {/* channel */}
      {ch &&
        (["up", "mid", "dn"] as const).map((k) => (
          <line
            key={k}
            x1={x(0)}
            x2={x(slots - 1)}
            y1={y(ch.at(0)[k])}
            y2={y(ch.at(slots - 1)[k])}
            stroke={k === "up" ? "#F43F5E" : k === "dn" ? "#10B981" : "#334155"}
            strokeWidth={k === "mid" ? 0.7 : 1}
            strokeDasharray={k === "mid" ? "3 3" : undefined}
            opacity={0.85}
          />
        ))}
      {/* key levels */}
      {levels && hLine(levels.pivot, "#94A3B8", "P", "2 3")}
      {levels && hLine(levels.r1, "#FB7185", "R1", "2 3")}
      {levels && hLine(levels.s1, "#34D399", "S1", "2 3")}
      {levels && hLine(levels.pdh, "#64748B", "PDH", "1 2")}
      {levels && hLine(levels.pdl, "#64748B", "PDL", "1 2")}
      {/* candles + volume */}
      {candles.map((c, i) => {
        const green = c.close >= c.open;
        const col = green ? "#16A34A" : "#DC2626";
        const bw = Math.max(1, cw * 0.62);
        return (
          <g key={c.date}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} stroke={col} strokeWidth={0.7} />
            <rect x={x(i) - bw / 2} y={y(Math.max(c.open, c.close))} width={bw} height={Math.max(0.8, Math.abs(y(c.open) - y(c.close)))} fill={col} />
            <rect x={x(i) - bw / 2} y={V_TOP + V_H - ((c.volume ?? 0) / maxVol) * V_H} width={bw} height={((c.volume ?? 0) / maxVol) * V_H} fill={green ? "rgba(22,163,74,.45)" : "rgba(220,38,38,.45)"} />
          </g>
        );
      })}
      {/* the call */}
      {hLine(plan?.stop, "#DC2626", "SL", undefined, true)}
      {hLine(plan?.entry, "#2563EB", "ENTRY", undefined, true)}
      {hLine(plan?.t1, "#059669", "T1", undefined, true)}
      {hLine(plan?.t2, "#047857", "T2", "4 2", true)}
      {hLine(last.close, "#0F172A", "NOW", "1 2")}
      {path && (
        <polyline
          points={path.map((p) => `${x(n - 1 + p.dx)},${y(Math.min(hi, Math.max(lo, p.price)))}`).join(" ")}
          fill="none"
          stroke="#0F766E"
          strokeWidth={1.6}
          strokeDasharray="5 3"
          markerEnd="url(#arrow)"
        />
      )}
      {plan && path && (
        <text x={x(n + 1)} y={up ? P_TOP + P_H - 4 : P_TOP + 10} fontSize={7.5} fontWeight={800} fill="#0F766E">
          {plan.label}
        </text>
      )}
      {/* time axis */}
      {candles.map((c, i) =>
        i % Math.ceil(n / 5) === 0 ? (
          <text key={`t${i}`} x={x(i)} y={H - 6} fontSize={7} fill="#64748B" textAnchor="middle">
            {istHM(c.date) === "09:00" ? `${istD(c.date)}th` : istHM(c.date)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function AiChart({ symbol, plan, levels }: { symbol: "CRUDEOIL" | "NATURALGAS"; plan: ChartPlan | null; levels: KeyLevels | null }) {
  const [tf, setTf] = useState<"15" | "60">("15");
  const q = useCandles(symbol, tf);
  const candles = q.data && "candles" in q.data ? q.data.candles.slice(tf === "15" ? -96 : -72) : null;
  return (
    <div className="rounded-2xl bg-white p-2 mt-3">
      <div className="flex items-center gap-1 mb-1.5 px-1">
        <p className="text-[11px] font-black text-slate-800">AI chart</p>
        {(["15", "60"] as const).map((t) => (
          <button key={t} onClick={() => setTf(t)} className={`ml-1 text-[10px] font-black rounded-md px-2 py-0.5 ${tf === t ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}>
            {t === "15" ? "15m" : "1h"}
          </button>
        ))}
      </div>
      {candles && candles.length >= 20 ? <Chart candles={candles} plan={plan} levels={levels} /> : <p className="text-[11px] text-slate-500 p-4 text-center">{q.isLoading ? "Loading candles…" : "Not enough candles to draw yet."}</p>}
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 px-1 mt-1.5 text-[9px] font-bold text-slate-600">
        <span className="text-emerald-700">■ buyers</span>
        <span className="text-rose-700">■ sellers</span>
        <span className="text-indigo-700">■ FVG gap</span>
        <span className="text-amber-700">■ wait zone</span>
        <span>— channel</span>
        <span className="text-teal-700">- - ➜ planned path</span>
      </div>
      <p className="text-[9px] text-slate-400 px-1 mt-0.5 leading-snug">The dashed path is the plan IF the setup works (pullback to the zone, then targets) — not a prediction. Price can break the zone instead; that is what the stop is for.</p>
    </div>
  );
}
