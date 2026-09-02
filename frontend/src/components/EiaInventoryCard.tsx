import { Database, TrendingUp, TrendingDown } from "lucide-react";
import { useEnergyData } from "../api/hooks";
import type { EiaScoreResult } from "../utils/newsScoring";

// A crude inventory DRAW (stocks fell) is bullish; a BUILD (stocks rose) is
// bearish. Same for NG storage. scoreEiaChange already encodes this in
// bullishScore/bearishScore, so the lean is read straight off those.
function leanOf(r: EiaScoreResult): "bullish" | "bearish" | "neutral" {
  if (r.bullishScore > r.bearishScore + 3) return "bullish";
  if (r.bearishScore > r.bullishScore + 3) return "bearish";
  return "neutral";
}

const LEAN = {
  bullish: { label: "Bullish", color: "#16A34A", emoji: "🟢" },
  bearish: { label: "Bearish", color: "#DC2626", emoji: "🔴" },
  neutral: { label: "Neutral", color: "#CA8A04", emoji: "🟡" },
};

function fmtCrude(thousandBbl: number): string {
  const m = thousandBbl / 1000; // series is in thousand barrels
  return `${m >= 0 ? "+" : "−"}${Math.abs(m).toFixed(1)}M bbl`;
}

function Row({ title, r, unit }: { title: string; r: EiaScoreResult; unit: "crude" | "ng" }) {
  const lean = leanOf(r);
  const vis = LEAN[lean];
  const changeStr = unit === "crude" ? fmtCrude(r.changeValue) : `${r.changeValue >= 0 ? "+" : "−"}${Math.abs(r.changeValue).toFixed(0)} Bcf`;
  const Arrow = r.direction === "draw" ? TrendingDown : TrendingUp;

  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: `${vis.color}0A`, border: `1px solid ${vis.color}26` }}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-black">{title}</p>
        <span className="text-[11px] font-black" style={{ color: vis.color }}>
          {vis.emoji} {vis.label}
        </span>
      </div>
      <div className="flex items-center justify-between mt-1">
        <p className="text-sm font-black flex items-center gap-1" style={{ color: vis.color }}>
          <Arrow size={14} />
          {r.direction === "draw" ? "Draw" : "Build"} {changeStr}
        </p>
        <p className="text-[10px] text-slate-400">
          {unit === "crude" ? `${(r.latestValue / 1000).toFixed(1)}M bbl total` : `${r.latestValue.toFixed(0)} Bcf total`}
        </p>
      </div>
      <p className="text-[10px] text-slate-500 mt-1 leading-snug">
        {r.direction === "draw"
          ? `Stocks fell vs last week — less supply, which supports higher prices.`
          : `Stocks rose vs last week — more supply, which pressures prices lower.`}
      </p>
    </div>
  );
}

export function EiaInventoryCard() {
  const { data } = useEnergyData();

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
          <Database size={13} className="text-rose-600" /> EIA Weekly Inventory
        </p>
        <span className="text-[9px] text-slate-400">latest official release</span>
      </div>

      {!data ? (
        <p className="px-4 pb-4 text-[11px] text-slate-400">Reading the latest EIA report…</p>
      ) : !data.available || (!data.crude && !data.ngStorage) ? (
        <p className="px-4 pb-4 text-[11px] text-slate-500">
          The latest EIA petroleum/storage numbers aren't available right now{data.error ? "" : " — they publish weekly (Crude ~Wed 8pm IST, Natural Gas ~Thu 8pm IST)"}. This fills in the moment the report lands.
        </p>
      ) : (
        <div className="px-3 pb-3 space-y-2">
          {data.crude && <Row title="Crude Oil Inventory" r={data.crude} unit="crude" />}
          {data.ngStorage && <Row title="Natural Gas Storage" r={data.ngStorage} unit="ng" />}
          <p className="text-[9px] text-slate-400 px-1">Real weekly numbers straight from the US EIA. Draw = bullish, Build = bearish — a big surprise vs expectations is what moves MCX hardest.</p>
        </div>
      )}
    </div>
  );
}
