// Both markets x four timeframes in one map: each cell is that timeframe's
// AI score and signal, coloured by the signal, with a dot when a call is
// running on it. Tap a cell to open its details below.

import { motion } from "framer-motion";
import type { TradeLogEntry } from "../../store/appStore";
import type { Decision6, TimeframeAnalysis } from "../../utils/timeframeEngine";
import { DECISION_HEX, DISPLAY_NAME, TF_SHORT, type TradableSymbol } from "./kit";

const SHORT: Record<Decision6, string> = { "STRONG BUY": "STRONG", BUY: "GOOD", "WATCH BUY": "RISKY", WAIT: "WAIT", SELL: "DON'T", "STRONG SELL": "DON'T" };

export interface MapRow {
  sym: TradableSymbol;
  analyses: TimeframeAnalysis[];
  logs: Record<string, TradeLogEntry[]>;
}

function mood(analyses: TimeframeAnalysis[]): string {
  const ok = analyses.filter((a) => a.overallScore !== null);
  if (!ok.length) return "no data yet";
  const up = ok.filter((a) => a.bias === "bullish").length;
  const dn = ok.filter((a) => a.bias === "bearish").length;
  return up > dn ? `${up} of ${ok.length} bullish` : dn > up ? `${dn} of ${ok.length} bearish` : "mixed";
}

/** star: "<SYMBOL>-<tf>" of the strongest live read, marked with a star. */
export function ConfluenceMap({ rows, sel, onSelect, stale, star }: { rows: MapRow[]; sel: { sym: TradableSymbol; tf: string }; onSelect: (sym: TradableSymbol, tf: string) => void; stale: boolean; star: string | null }) {
  return (
    <section className="rounded-3xl bg-white/[0.04] border border-white/10 p-3.5 space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-black">Signal map</p>
        <p className="text-[10px] text-white/45">{stale ? "Readings from the last close · tap a cell" : "Tap a cell for the full read"}</p>
      </div>
      {rows.map((row, ri) => (
        <div key={row.sym} className="space-y-1.5">
          <p className="text-[11px] font-bold text-white/70">
            {row.sym === "CRUDEOIL" ? "🛢️" : "🔥"} {DISPLAY_NAME[row.sym]} <span className="text-white/40 font-semibold">· {mood(row.analyses)}</span>
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {row.analyses.map((a, ci) => {
              const log = row.logs[`${row.sym}-${a.tf}`] ?? [];
              const last = log[log.length - 1];
              const running = last && !last.closed ? last : null;
              const on = sel.sym === row.sym && sel.tf === a.tf;
              const hex = a.insufficient || a.overallScore === null ? "#64748B" : DECISION_HEX[a.decision];
              return (
                <motion.button
                  key={a.tf}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (ri * 4 + ci) * 0.03 }}
                  onClick={() => onSelect(row.sym, a.tf)}
                  aria-pressed={on}
                  aria-label={`${DISPLAY_NAME[row.sym]} ${a.label}`}
                  className={`relative rounded-2xl px-1 pt-1.5 pb-2 text-center border transition-transform ${on ? "scale-[1.04] border-white/80 shadow-lg" : "border-white/10"}`}
                  style={{ background: `linear-gradient(160deg,${hex}38,${hex}12)` }}
                >
                  {running && (
                    <span className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] font-black text-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                      {running.optSide}
                    </span>
                  )}
                  <p className="text-[9.5px] font-bold text-white/55 text-left pl-1">
                    {TF_SHORT[a.tf] ?? a.label}
                    {star === `${row.sym}-${a.tf}` && <span className="text-amber-300"> ★</span>}
                  </p>
                  <p className="text-[21px] font-black leading-none mt-0.5" style={{ color: hex }}>
                    {a.insufficient || a.overallScore === null ? "—" : Math.round(a.overallScore)}
                  </p>
                  <p className="text-[9px] font-black tracking-wide mt-1" style={{ color: hex }}>
                    {a.insufficient ? "NO DATA" : a.decision === "WAIT" && a.vetoes.length ? "HELD" : SHORT[a.decision]}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-white/45 pt-0.5">
        <span><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: DECISION_HEX["STRONG BUY"] }} />Strong / Good buy</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: DECISION_HEX["WATCH BUY"] }} />Risky buy</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: DECISION_HEX.WAIT }} />Wait</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: DECISION_HEX["STRONG SELL"] }} />Don't buy</span>
        <span><span className="inline-block w-2 h-2 rounded-full mr-1 align-middle bg-amber-300" />Call running</span>
        <span className="text-amber-300">★ strongest read now</span>
        <span>HELD = a safety rule stopped it · tap for why</span>
      </div>
    </section>
  );
}
