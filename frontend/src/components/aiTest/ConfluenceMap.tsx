// Both markets x four timeframes in one map: each cell is that timeframe's
// AI score and signal on its own colour, with a dot when a call is running on
// it. Tap a cell to open its details below.

import { motion } from "framer-motion";
import type { TradeLogEntry } from "../../store/appStore";
import type { Decision6, TimeframeAnalysis } from "../../utils/timeframeEngine";
import { DECISION_GRAD, DECISION_HEX, DISPLAY_NAME, NO_DATA_GRAD, TF_SHORT, type TradableSymbol } from "./kit";

const SHORT: Record<Decision6, string> = { "STRONG BUY": "STRONG", BUY: "GOOD", "WATCH BUY": "RISKY", WAIT: "WAIT", SELL: "DON'T", "STRONG SELL": "DON'T" };

export interface MapRow {
  sym: TradableSymbol;
  analyses: TimeframeAnalysis[];
  logs: Record<string, TradeLogEntry[]>;
}

function mood(analyses: TimeframeAnalysis[]): { text: string; cls: string } {
  const ok = analyses.filter((a) => a.overallScore !== null);
  if (!ok.length) return { text: "no data yet", cls: "bg-slate-100 text-slate-500" };
  const up = ok.filter((a) => a.bias === "bullish").length;
  const dn = ok.filter((a) => a.bias === "bearish").length;
  if (up > dn) return { text: `${up} of ${ok.length} bullish`, cls: "bg-emerald-100 text-emerald-700" };
  if (dn > up) return { text: `${dn} of ${ok.length} bearish`, cls: "bg-rose-100 text-rose-700" };
  return { text: "mixed", cls: "bg-amber-100 text-amber-700" };
}

const Dot = ({ bg }: { bg: string }) => <span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: bg }} />;

/** star: "<SYMBOL>-<tf>" of the strongest live read, marked with a star. */
export function ConfluenceMap({ rows, sel, onSelect, stale, star }: { rows: MapRow[]; sel: { sym: TradableSymbol; tf: string }; onSelect: (sym: TradableSymbol, tf: string) => void; stale: boolean; star: string | null }) {
  return (
    <section className="rounded-3xl bg-white shadow-md shadow-sky-200/50 p-3.5 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-black bg-gradient-to-r from-violet-600 via-fuchsia-600 to-orange-500 bg-clip-text text-transparent">Signal map</p>
        <p className="text-[10px] font-semibold text-slate-400">{stale ? "Readings from the last close · tap a cell" : "Tap a cell for the full read"}</p>
      </div>
      {rows.map((row, ri) => {
        const m = mood(row.analyses);
        return (
          <div key={row.sym} className="space-y-1.5">
            <p className="text-[12px] font-black text-slate-700 flex items-center gap-1.5">
              {row.sym === "CRUDEOIL" ? "🛢️" : "🔥"} {DISPLAY_NAME[row.sym]}
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${m.cls}`}>{m.text}</span>
            </p>
            <div className="grid grid-cols-4 gap-2">
              {row.analyses.map((a, ci) => {
                const log = row.logs[`${row.sym}-${a.tf}`] ?? [];
                const last = log[log.length - 1];
                const running = last && !last.closed ? last : null;
                const on = sel.sym === row.sym && sel.tf === a.tf;
                const none = !!a.insufficient || a.overallScore === null;
                return (
                  <motion.button
                    key={a.tf}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (ri * 4 + ci) * 0.03 }}
                    onClick={() => onSelect(row.sym, a.tf)}
                    aria-pressed={on}
                    aria-label={`${DISPLAY_NAME[row.sym]} ${a.label}`}
                    className={`relative rounded-2xl px-1 pt-1.5 pb-2 text-center shadow-sm transition-transform ${none ? "text-slate-500" : "text-white"} ${on ? "scale-[1.05] ring-4 ring-violet-500 ring-offset-2" : ""}`}
                    style={{ background: none ? NO_DATA_GRAD : DECISION_GRAD[a.decision] }}
                  >
                    {running && (
                      <span className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] font-black bg-white/90 text-slate-800 rounded-full px-1 py-px">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                        {running.optSide}
                      </span>
                    )}
                    <p className="text-[9.5px] font-black text-left pl-1 opacity-90">
                      {TF_SHORT[a.tf] ?? a.label}
                      {star === `${row.sym}-${a.tf}` && <span className="text-yellow-200 drop-shadow"> ★</span>}
                    </p>
                    <p className="text-[22px] font-black leading-none mt-0.5 drop-shadow-sm">{none ? "—" : Math.round(a.overallScore!)}</p>
                    <p className="text-[9px] font-black tracking-wide mt-1">{a.insufficient ? "NO DATA" : a.decision === "WAIT" && a.vetoes.length ? "HELD" : SHORT[a.decision]}</p>
                  </motion.button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] font-semibold text-slate-500 pt-0.5">
        <span><Dot bg={DECISION_HEX["STRONG BUY"]} />Strong / Good buy</span>
        <span><Dot bg={DECISION_HEX["WATCH BUY"]} />Risky buy</span>
        <span><Dot bg="#F59E0B" />Wait</span>
        <span><Dot bg={DECISION_HEX["STRONG SELL"]} />Don't buy</span>
        <span><Dot bg="#F97316" />Call running</span>
        <span className="text-amber-600">★ strongest read now</span>
        <span>HELD = a safety rule stopped it · tap for why</span>
      </div>
    </section>
  );
}
