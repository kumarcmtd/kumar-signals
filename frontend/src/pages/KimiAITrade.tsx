import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Calculator, BookOpen, Zap } from "lucide-react";
import { useOptionsAnalytics } from "../api/hooks";
import {
  NATURAL_GAS_SETUPS,
  CRUDE_OIL_SETUPS,
  ALL_CONFLUENCE_FACTORS,
  calculateHitProbability,
  calculatePotentialLeft,
  type PlaybookSetup,
  type Commodity,
  type ConfluenceFactor,
  type Recommendation,
} from "../utils/kimiPlaybook";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOL_TO_COMMODITY: Record<TradableSymbol, Commodity> = { CRUDEOIL: "CL", NATURALGAS: "NG" };
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const RECOMMENDATION_STYLE: Record<Recommendation, { bg: string; text: string }> = {
  "STRONG BUY": { bg: "#DCFCE7", text: "#15803D" },
  BUY: { bg: "#DBEAFE", text: "#1D4ED8" },
  MARGINAL: { bg: "#FEF3C7", text: "#B45309" },
  SKIP: { bg: "#FEE2E2", text: "#B91C1C" },
};

export function KimiAITrade() {
  const [symbol, setSymbol] = useState<TradableSymbol>("NATURALGAS");
  const [expandedSetup, setExpandedSetup] = useState<string | null>(null);
  const [selectedFactors, setSelectedFactors] = useState<Set<ConfluenceFactor>>(new Set());
  const [calcSetup, setCalcSetup] = useState<PlaybookSetup | null>(null);

  const [entry, setEntry] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [ltp, setLtp] = useState("");

  const commodity = SYMBOL_TO_COMMODITY[symbol];
  const setups = symbol === "NATURALGAS" ? NATURAL_GAS_SETUPS : CRUDE_OIL_SETUPS;
  const { data: options } = useOptionsAnalytics(symbol);

  const probabilityResult = useMemo(() => {
    if (!calcSetup) return null;
    const result = calculateHitProbability(calcSetup.setupName, commodity, Array.from(selectedFactors));
    return "error" in result ? null : result;
  }, [calcSetup, commodity, selectedFactors]);

  const potentialResult = useMemo(() => {
    const e = Number(entry),
      s = Number(stopLoss),
      t = Number(target),
      l = Number(ltp);
    if (!e || !s || !t || !l) return null;
    return calculatePotentialLeft(e, s, t, l);
  }, [entry, stopLoss, target, ltp]);

  const useLivePremium = () => {
    if (!options || options.error || options.atmStrike === null) return;
    const row = options.rows.find((r) => r.strike === options.atmStrike);
    const side = calcSetup?.direction === "PE" ? row?.put : row?.call;
    if (side?.ltp !== null && side?.ltp !== undefined) setLtp(String(side.ltp));
  };

  const toggleFactor = (key: ConfluenceFactor) => {
    setSelectedFactors((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#FFF7ED,#FFFFFF 30%)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-orange-500 via-amber-500 to-rose-500 bg-clip-text text-transparent">Kimi AI Trade</h1>
        <p className="text-xs text-slate-500 px-4">A setup playbook + calculators, ported from a user-supplied AI-generated trading document.</p>
      </section>

      {/* HONESTY DISCLAIMER — the whole point of this banner */}
      <section className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
        <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
          <AlertTriangle size={14} /> Important: these stats are unverified
        </p>
        <p className="text-[11px] text-amber-700 mt-1.5 leading-relaxed">
          The win-rate, profit-factor, and expectancy numbers shown for each setup below came from the AI-generated document you provided — they are <b>not</b> real backtests run against MCX
          historical data by this app. Treat them as illustrative reference points, not proven results. The two calculators (Hit Probability and Potential Left) are real, deterministic math —
          those work correctly regardless of which numbers you feed them.
        </p>
      </section>

      {/* SYMBOL SELECTOR */}
      <div className="flex gap-2">
        {(["NATURALGAS", "CRUDEOIL"] as TradableSymbol[]).map((sym) => (
          <button
            key={sym}
            onClick={() => {
              setSymbol(sym);
              setCalcSetup(null);
            }}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold border transition-all ${
              symbol === sym ? "bg-orange-500 text-white border-orange-500" : "bg-white text-slate-500 border-slate-200"
            }`}
          >
            {DISPLAY_NAME[sym]}
          </button>
        ))}
      </div>

      {/* SETUP CATALOG */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-1.5">
          <BookOpen size={14} /> Setup Playbook — {DISPLAY_NAME[symbol]}
        </p>
        <div className="space-y-2">
          {setups.map((s) => {
            const open = expandedSetup === s.setupName;
            return (
              <div key={s.setupName} className="rounded-xl border border-slate-100 overflow-hidden">
                <button onClick={() => setExpandedSetup(open ? null : s.setupName)} className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-50">
                  <div className="text-left">
                    <p className="text-sm font-bold text-slate-800">{s.setupName}</p>
                    <p className="text-[10px] text-slate-400">
                      {s.direction} · {s.bestTimeframe}
                    </p>
                  </div>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                </button>
                {open && (
                  <div className="p-3 space-y-2.5">
                    <p className="text-[11px] text-slate-600">{s.description}</p>

                    <div>
                      <p className="text-[9px] font-bold uppercase text-emerald-600 mb-1">Entry Rules</p>
                      {s.entryRules.map((r, i) => (
                        <p key={i} className="text-[11px] text-slate-600">
                          • {r}
                        </p>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[9px] font-bold uppercase text-rose-600 mb-1">Stop Loss</p>
                        {s.stopLossRules.map((r, i) => (
                          <p key={i} className="text-[11px] text-slate-600">
                            • {r}
                          </p>
                        ))}
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase text-sky-600 mb-1">Target</p>
                        {s.targetRules.map((r, i) => (
                          <p key={i} className="text-[11px] text-slate-600">
                            • {r}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase text-amber-600 mb-1">Avoid When</p>
                      {s.avoidWhen.map((r, i) => (
                        <p key={i} className="text-[11px] text-slate-600">
                          • {r}
                        </p>
                      ))}
                    </div>

                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5">
                      <p className="text-[9px] font-bold uppercase text-slate-400 mb-1.5">Reference Stats (unverified — see disclaimer above)</p>
                      <div className="grid grid-cols-3 gap-1.5 text-[10px] text-slate-500">
                        <span>Trades: {s.trades}</span>
                        <span>Win Rate: {s.winRate}%</span>
                        <span>RR: {s.rrRatio}</span>
                        <span>Avg Win: {s.avgWin}</span>
                        <span>Avg Loss: {s.avgLoss}</span>
                        <span>Expectancy: {s.expectancy}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setCalcSetup(s);
                        setSelectedFactors(new Set());
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-white"
                      style={{ background: "linear-gradient(135deg,#F59E0B,#EF4444)" }}
                    >
                      <Calculator size={13} /> Calculate Hit Probability
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* HIT PROBABILITY CALCULATOR */}
      {calcSetup && (
        <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
          <p className="text-xs font-bold uppercase text-slate-400 mb-1">Hit Probability Calculator</p>
          <p className="text-sm font-bold text-slate-800 mb-3">{calcSetup.setupName}</p>

          <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1.5">Positive Factors</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {ALL_CONFLUENCE_FACTORS.filter((f) => f.positive).map((f) => (
              <FactorChip key={f.key} label={f.label} value={f.value} active={selectedFactors.has(f.key)} onClick={() => toggleFactor(f.key)} positive />
            ))}
          </div>
          <p className="text-[10px] font-bold text-rose-600 uppercase mb-1.5">Negative Factors</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {ALL_CONFLUENCE_FACTORS.filter((f) => !f.positive).map((f) => (
              <FactorChip key={f.key} label={f.label} value={f.value} active={selectedFactors.has(f.key)} onClick={() => toggleFactor(f.key)} positive={false} />
            ))}
          </div>

          {probabilityResult && (
            <div className="rounded-xl p-3" style={{ background: RECOMMENDATION_STYLE[probabilityResult.recommendation].bg }}>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <StatBox label="Base" value={`${probabilityResult.baseProbability}%`} />
                <StatBox label="Adjustment" value={`${probabilityResult.totalAdjustment >= 0 ? "+" : ""}${probabilityResult.totalAdjustment}`} />
                <StatBox label="Final" value={`${probabilityResult.finalProbability}%`} bold />
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <StatBox label="Edge Score" value={String(probabilityResult.edgeScore)} />
                <StatBox label="RR Ratio" value={`1:${probabilityResult.rrRatio}`} />
              </div>
              <p className="text-sm font-black text-center mt-1" style={{ color: RECOMMENDATION_STYLE[probabilityResult.recommendation].text }}>
                {probabilityResult.recommendation}
              </p>
            </div>
          )}
        </section>
      )}

      {/* POTENTIAL LEFT CALCULATOR */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-3 flex items-center gap-1.5">
          <Zap size={14} /> Potential Left Calculator
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumInput label="Entry" value={entry} onChange={setEntry} />
          <NumInput label="Stop Loss" value={stopLoss} onChange={setStopLoss} />
          <NumInput label="Target" value={target} onChange={setTarget} />
          <NumInput label="Current LTP" value={ltp} onChange={setLtp} />
        </div>
        <button onClick={useLivePremium} disabled={!calcSetup || !options || !!options.error} className="w-full mt-2 py-2 rounded-lg text-[11px] font-bold border border-orange-200 text-orange-700 bg-orange-50 disabled:opacity-40">
          Use live ATM premium ({calcSetup ? `${calcSetup.direction === "PE" ? "PE" : "CE"}` : "pick a setup above first"})
        </button>

        {potentialResult && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <StatBox label="Risk" value={String(potentialResult.risk)} />
            <StatBox label="Reward" value={String(potentialResult.reward)} />
            <StatBox label="RR Ratio" value={`1:${potentialResult.rrRatio}`} />
            <StatBox label="Potential Left" value={`${potentialResult.potentialLeftPercent}%`} bold />
            <StatBox label="Distance to SL" value={`${potentialResult.distanceToSlPercent}%`} />
          </div>
        )}
      </section>

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">Educational reference only, not financial advice. Verify every setup on the live chart before acting.</p>
    </div>
  );
}

function FactorChip({ label, value, active, onClick, positive }: { label: string; value: number; active: boolean; onClick: () => void; positive: boolean }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors"
      style={
        active
          ? { background: positive ? "#16A34A" : "#DC2626", color: "#fff", borderColor: positive ? "#16A34A" : "#DC2626" }
          : { background: "#F8FAFC", color: "#64748B", borderColor: "#E2E8F0" }
      }
    >
      {label} ({value >= 0 ? "+" : ""}
      {value})
    </button>
  );
}

function StatBox({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="rounded-lg bg-white/60 px-2.5 py-2 border border-slate-100">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className={`text-slate-800 ${bold ? "text-base font-black" : "text-xs font-bold"}`}>{value}</p>
    </div>
  );
}

function NumInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] text-slate-400">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-full mt-0.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-bold text-slate-800" />
    </label>
  );
}
