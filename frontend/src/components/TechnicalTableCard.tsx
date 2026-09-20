import { useState } from "react";
import { Table2, ChevronDown, ChevronUp, Info } from "lucide-react";
import { buildTechnicalTable, type Indication } from "../utils/technicalTable";
import type { Candle } from "../types";

const INK: Record<Indication, { color: string; bg: string; text: string }> = {
  bullish: { color: "#15803D", bg: "#DCFCE7", text: "Bullish" },
  bearish: { color: "#B91C1C", bg: "#FEE2E2", text: "Bearish" },
  neutral: { color: "#B45309", bg: "#FEF3C7", text: "Neutral" },
  info: { color: "#475569", bg: "#F1F5F9", text: "Info" },
  unavailable: { color: "#94A3B8", bg: "#F8FAFC", text: "No data" },
};

function Chip({ indication }: { indication: Indication }) {
  const i = INK[indication];
  return (
    <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md shrink-0" style={{ background: i.bg, color: i.color }}>
      {i.text}
    </span>
  );
}

/**
 * Every standard indicator in one readable table, so the app's numbers can be
 * checked against the public analysis sites that quote these by name.
 *
 * The summary deliberately leads with INDEPENDENT GROUPS rather than a raw
 * count of green rows. Five momentum oscillators agreeing is one opinion
 * repeated, not five confirmations, and a page that counts them as five makes
 * the market look far more decided than it is.
 */
export function TechnicalTableCard({ candles, timeframeLabel }: { candles: Candle[]; timeframeLabel: string }) {
  const [open, setOpen] = useState(false);
  const t = buildTechnicalTable(candles);

  if (candles.length === 0) return null;

  const summaryInk = t.familiesBullish > t.familiesBearish ? "#15803D" : t.familiesBearish > t.familiesBullish ? "#B91C1C" : "#B45309";

  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2.5 flex items-center gap-2 text-left">
        <Table2 size={14} className="text-indigo-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-slate-800">Technical table · {timeframeLabel}</p>
          <p className="text-[10px] font-bold" style={{ color: summaryInk }}>{t.summaryLabel}</p>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* The caveat comes first, because the counts below invite exactly
              the mistake it warns about. */}
          <div className="rounded-xl px-2.5 py-2 flex items-start gap-1.5" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
            <Info size={11} className="shrink-0 mt-0.5" style={{ color: "#B45309" }} />
            <p className="text-[9.5px] text-slate-600 leading-snug">{t.summaryNote}</p>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Moving averages</p>
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-50 text-[9px] font-bold uppercase text-slate-400">
                <span className="w-[34px] shrink-0">Period</span>
                <span className="flex-1 text-right">SMA</span>
                <span className="flex-1 text-right">EMA</span>
                <span className="w-[54px] shrink-0" />
              </div>
              {t.movingAverages.map((m) => (
                <div key={m.period} className="flex items-center gap-2 px-2.5 py-1.5 border-b last:border-b-0 border-slate-100">
                  <span className="text-[10.5px] font-bold text-slate-700 w-[34px] shrink-0">{m.period}</span>
                  <span className="flex-1 text-right text-[10.5px] tabular-nums text-slate-700">{m.sma === null ? "—" : m.sma.toFixed(2)}</span>
                  <span className="flex-1 text-right text-[10.5px] tabular-nums text-slate-500">{m.ema === null ? "—" : m.ema.toFixed(2)}</span>
                  <span className="w-[54px] shrink-0 flex justify-end"><Chip indication={m.indication} /></span>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-slate-400 mt-1 leading-snug">
              Bullish simply means price is above that average. Long averages lag by design — a 200-period average has not registered today's move yet.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Crossovers</p>
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              {t.crossovers.map((c) => (
                <div key={c.term} className="flex items-center gap-2 px-2.5 py-1.5 border-b last:border-b-0 border-slate-100">
                  <span className="text-[10.5px] font-bold text-slate-700 flex-1">{c.term}</span>
                  <span className="text-[10px] text-slate-400">{c.label}</span>
                  <Chip indication={c.indication} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Indicators</p>
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              {t.indicators.map((r) => (
                <div key={r.key} className="px-2.5 py-2 border-b last:border-b-0 border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-bold text-slate-700 flex-1 min-w-0 truncate">{r.label}</span>
                    <span className="text-[10.5px] tabular-nums text-slate-700 shrink-0">{r.value ?? "—"}</span>
                    <Chip indication={r.indication} />
                  </div>
                  <p className="text-[9px] text-slate-400 leading-snug mt-0.5">{r.note}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[9px] text-slate-400 leading-relaxed">
            These are reference readings only — none of them feeds any signal score in this app, on purpose. Calculated from MCX {timeframeLabel} bars in rupees, so they will not
            match a site quoting WTI in dollars on a daily chart even when the indicator and its settings are identical.
          </p>
        </div>
      )}
    </div>
  );
}
