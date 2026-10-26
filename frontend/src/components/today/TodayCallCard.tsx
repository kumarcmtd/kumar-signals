// One timeframe's call on Ai-Today, laid out like an Ai20-20 call: option,
// called time and entry premium, live premium and P&L, stop and three
// targets, the price scale, the investment box, and the AI chart.

import { useState } from "react";
import { Crown } from "lucide-react";
import { liveLtpFor } from "../../hooks/useTradeLog";
import { PriceScale, ProfitEstimate } from "../CallCardKit";
import { AiChart } from "../trust/AiChart";
import { premiumToFutures } from "../../utils/chartMarks";
import { LOT_SIZE } from "../../utils/aiTwentyTwentyEngine";
import type { TradeLogEntry } from "../../utils/tradeLogCore";
import type { TfRecord, FocusSym } from "../../hooks/useTodayFocus";
import type { TimeframeAnalysis } from "../../utils/timeframeEngine";
import type { Candle, OptionsAnalytics } from "../../types";

const STATUS: Record<TradeLogEntry["status"], { t: string; bg: string; fg: string }> = {
  running: { t: "RUNNING", bg: "#FEF3C7", fg: "#92400E" },
  sl_hit: { t: "STOP HIT ✗", bg: "#FFE4E6", fg: "#9F1239" },
  stopped_breakeven: { t: "EXIT AT COST", bg: "#E0E7FF", fg: "#3730A3" },
  stopped_after_t1: { t: "T1 HIT ✓", bg: "#D1FAE5", fg: "#065F46" },
  target3_hit: { t: "ALL TARGETS ✓", bg: "#D1FAE5", fg: "#065F46" },
  closed_manual: { t: "CLOSED", bg: "#F1F5F9", fg: "#475569" },
  closed_eod: { t: "DAY END", bg: "#E0E7FF", fg: "#3730A3" },
};
const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Box({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl px-1.5 py-1.5 text-center" style={{ background: tone === "good" ? "#ECFDF5" : tone === "bad" ? "#FFF1F2" : "#F8FAFC" }}>
      <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
      <p className={`text-[13.5px] font-black ${tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}

export function TodayCallCard({
  sym,
  short,
  entry,
  analysis,
  record,
  options,
  candles,
  best,
  warn,
}: {
  sym: FocusSym;
  short: string;
  entry: TradeLogEntry | null;
  analysis: TimeframeAnalysis;
  record: TfRecord;
  options: OptionsAnalytics | undefined;
  candles: Candle[];
  best: boolean;
  warn: string | null;
}) {
  const [chart, setChart] = useState(false);
  const live = entry ? liveLtpFor(options, entry.strike, entry.optSide) : null;
  const current = entry ? (entry.closed ? (entry.exitPrice ?? null) : live) : null;
  const pnl = entry && current !== null ? ((current - entry.entry) / entry.entry) * 100 : null;
  const st = entry ? STATUS[entry.status] : null;
  const ce = entry?.optSide === "CE";
  const recordLine = record.closed ? `${short} here: ${record.winRate ?? "—"}% win · ${record.wins}W ${record.losses}L` : `${short}: no results yet`;

  const row = entry && options && !options.error ? options.rows.find((r) => r.strike === entry.strike) : undefined;
  const leg = row && entry ? (entry.optSide === "CE" ? row.call : row.put) : undefined;
  const delta = typeof leg?.delta === "number" && Math.abs(leg.delta) >= 0.05 ? leg.delta : ce ? 0.5 : -0.5;
  const before = entry ? candles.filter((c) => Date.parse(c.date) <= entry.openedAt) : [];
  const fut = premiumToFutures(entry ?? { entry: 0, stop: 0, targets: [0] }, delta, before.length ? before[before.length - 1].close : null);

  return (
    <div className={`relative rounded-3xl bg-white overflow-hidden border ${best ? "border-amber-300 shadow-xl" : "border-slate-100 shadow-md"}`}>
      <div className="absolute left-0 top-0 bottom-0 w-2" style={{ background: entry ? (ce ? "#10B981" : "#F43F5E") : "#CBD5E1" }} />
      <div className="pl-5 pr-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black rounded-lg bg-slate-900 text-white px-2 py-0.5">{short}</span>
          {best && (
            <span className="text-[10.5px] font-black rounded-lg px-2 py-0.5 text-amber-900 flex items-center gap-1" style={{ background: "linear-gradient(135deg,#FDE68A,#FBBF24)" }}>
              <Crown size={11} /> BEST NOW
            </span>
          )}
          <span className="text-[10.5px] font-bold text-slate-500 truncate">{recordLine}</span>
          {st && (
            <span className="ml-auto text-[10px] font-black rounded-md px-1.5 py-0.5 shrink-0" style={{ background: st.bg, color: st.fg }}>
              {st.t}
            </span>
          )}
        </div>
        {entry ? (
          <>
            <p className="text-[21px] font-black text-slate-900 leading-tight mt-1">
              {entry.strike} <span className={ce ? "text-emerald-600" : "text-rose-600"}>{entry.optSide}</span>
              <span className="text-[12px] font-bold text-slate-500"> · {analysis.decision}</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Called {when(entry.openedAt)} at ₹{entry.entry.toFixed(2)}
            </p>
            {warn && <p className="mt-1 text-[11px] font-black text-amber-700">⚠ {warn}</p>}
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              <Box label="Entry" value={`₹${entry.entry.toFixed(2)}`} />
              <Box label={entry.closed ? "Exit" : "Live"} value={current !== null ? `₹${current.toFixed(2)}` : "—"} />
              <Box label="P&L" value={pnl !== null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%` : "—"} tone={pnl === null ? undefined : pnl >= 0 ? "good" : "bad"} />
              <Box label="Stop" value={`₹${entry.stop.toFixed(2)}`} tone="bad" />
              <Box label="T1 / T2" value={`₹${entry.targets[0].toFixed(1)} / ${entry.targets[1].toFixed(1)}`} tone="good" />
              <Box label="T3" value={`₹${entry.targets[2].toFixed(2)}`} tone="good" />
            </div>
            {!entry.closed && (
              <p className="mt-1.5 text-[11px] font-bold text-violet-700">
                Upstox P&L exit / lot: profit +₹{Math.round((entry.targets[0] - entry.entry) * LOT_SIZE[sym]).toLocaleString("en-IN")} · loss −₹{Math.round((entry.entry - entry.stop) * LOT_SIZE[sym]).toLocaleString("en-IN")}
              </p>
            )}
          </>
        ) : (
          <p className="text-[13px] font-bold text-slate-600 mt-1.5">
            No call — {analysis.insufficient ?? `${analysis.decision}${analysis.vetoes[0] ? ` · ${analysis.vetoes[0]}` : ""}`}
          </p>
        )}
      </div>
      {entry && <PriceScale entry={entry} current={current} />}
      {entry && <ProfitEstimate trade={entry} current={current} lotSize={LOT_SIZE[sym]} />}
      {entry && (
        <div className="px-4 pb-3">
          <button onClick={() => setChart((x) => !x)} className="w-full rounded-xl bg-violet-50 text-violet-800 py-2 text-[12px] font-black">
            {chart ? "Hide AI chart" : "📈 AI chart — zones, FVG, this call's levels"}
          </button>
          {chart && (
            <AiChart
              symbol={sym}
              plan={fut ? { side: entry.optSide, entry: fut.entry, stop: fut.stop, t1: fut.t1, t2: fut.t2, zone: null, label: `${short} call (approx. futures)` } : null}
              levels={null}
            />
          )}
        </div>
      )}
    </div>
  );
}
