import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Calculator, BookOpen, Zap, Radar, TrendingUp, TrendingDown, ClipboardList } from "lucide-react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { TIMEFRAMES } from "../hooks/useTimeframeSuite";
import { useKimiTradeLog } from "../hooks/useKimiTradeLog";
import { scanAllSetups, type TimedScanResult } from "../utils/kimiScanner";
import type { OptionsAnalytics } from "../types";
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

// The 3 news/calendar-driven setups (EIA Storage/Inventory Reversal, OPEC News
// Gap Fill) can't be honestly detected without a real economic-calendar feed --
// this app has none, so they're excluded from live scanning and stay
// catalog-only above, with that limitation stated in the UI.
const NEWS_DRIVEN_SETUPS = new Set(["EIA Storage Reversal (Post-Data)", "EIA Inventory Reversal", "OPEC News Gap Fill"]);

interface ScanPremium {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  target: number;
  stop: number;
}

function projectScanPremium(result: TimedScanResult, options: OptionsAnalytics | undefined): ScanPremium | null {
  if (!options || options.error || options.atmStrike === null) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const optSide: "CE" | "PE" = result.direction === "bullish" ? "CE" : "PE";
  const leg = optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const DELTA = 0.5;
  const favMove = Math.abs(result.target - result.entry);
  const riskMove = Math.abs(result.entry - result.stop);
  const entry = leg.ltp;
  const target = Number((entry + DELTA * favMove).toFixed(2));
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  return { strike: row.strike, optSide, entry, target, stop };
}

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

  const c5 = useCandles(symbol, "5");
  const c10 = useCandles(symbol, "10");
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const tfQueries = [c5, c10, c15, c30, c60, c240];
  const scanLoading = tfQueries.some((q) => q.isLoading);

  const liveSuggestions = useMemo(() => {
    const timeframes = TIMEFRAMES.map(({ tf, label }, i) => ({ tf, label, candles: tfQueries[i].data?.candles ?? [] }));
    return scanAllSetups(commodity, timeframes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, c5.data, c10.data, c15.data, c30.data, c60.data, c240.data]);

  const projectPremiumFor = useCallback((r: TimedScanResult) => projectScanPremium(r, options), [options]);
  const ledger = useKimiTradeLog(symbol, liveSuggestions, projectPremiumFor, options);

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

      {/* LIVE TRADE SUGGESTIONS */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-1 flex items-center gap-1.5">
          <Radar size={14} /> Live Trade Suggestions — {DISPLAY_NAME[symbol]}
        </p>
        <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
          Scans live candles (5m–4H) against each setup's own entry rules below. 3 news/calendar-driven setups (EIA Storage/Inventory Reversal, OPEC News Gap Fill) are excluded — this app has no
          economic-calendar feed to confirm those honestly, so they stay catalog-only above.
        </p>
        {scanLoading ? (
          <p className="text-xs text-slate-400 text-center py-4">Loading live candles…</p>
        ) : liveSuggestions.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No setup is currently triggering on {DISPLAY_NAME[symbol]}. Check back after the next few candles.</p>
        ) : (
          <div className="space-y-2">
            {liveSuggestions.map((r, i) => {
              const premium = projectScanPremium(r, options);
              const bullish = r.direction === "bullish";
              const probResult = calculateHitProbability(r.setupName, commodity, []);
              const baseProb = "error" in probResult ? null : probResult.baseProbability;
              return (
                <div key={`${r.setupName}-${r.tf}-${i}`} className="rounded-xl border border-slate-100 p-3" style={{ background: bullish ? "#F0FDF4" : "#FEF2F2" }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                      {bullish ? <TrendingUp size={14} className="text-emerald-600" /> : <TrendingDown size={14} className="text-rose-600" />}
                      {r.setupName}
                    </p>
                    <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500">{r.tfLabel}</span>
                  </div>
                  {baseProb !== null && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Base Hit Probability (reference stats, no confluence factors applied): <span className="font-bold text-slate-700">{baseProb}%</span>
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-1.5 mt-2 text-[10px]">
                    <StatBox label="Entry (underlying)" value={r.entry.toFixed(2)} />
                    <StatBox label="Stop" value={r.stop.toFixed(2)} />
                    <StatBox label="Target" value={r.target.toFixed(2)} />
                  </div>
                  {premium && (
                    <div className="grid grid-cols-3 gap-1.5 mt-1.5 text-[10px]">
                      <StatBox label={`${premium.strike} ${premium.optSide} Entry`} value={String(premium.entry)} />
                      <StatBox label="Premium Stop" value={String(premium.stop)} />
                      <StatBox label="Premium Target" value={String(premium.target)} />
                    </div>
                  )}
                  <div className="mt-1.5 space-y-0.5">
                    {r.notes.map((n, ni) => (
                      <p key={ni} className="text-[10px] text-slate-500">
                        • {n}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* TRADE LEDGER */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-1 flex items-center gap-1.5">
          <ClipboardList size={14} /> Trade Ledger — {DISPLAY_NAME[symbol]}
        </p>
        <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
          Every live suggestion above is tracked as its own line the moment it fires, using the option premium entry/stop/target shown. Win Rate % below is this ledger's own real, running track
          record — not a playbook reference stat.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <StatBox label="Win Rate (real track record)" value={ledger.winRatePct !== null ? `${ledger.winRatePct}%` : "— (no closed trades yet)"} bold color={ledger.winRatePct !== null ? (ledger.winRatePct >= 50 ? "#16A34A" : "#DC2626") : undefined} />
          <StatBox label="Currently Running" value={String(ledger.running)} color="#D97706" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatBox label="Target Hit" value={String(ledger.targetHit)} color="#16A34A" />
          <StatBox label="SL Hit" value={String(ledger.slHit)} color="#DC2626" />
        </div>
      </section>

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
                    <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                      {s.setupName}
                      {NEWS_DRIVEN_SETUPS.has(s.setupName) && (
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">Catalog only — no news feed</span>
                      )}
                    </p>
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

function StatBox({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <div className="rounded-lg bg-white/60 px-2.5 py-2 border border-slate-100">
      <p className="text-[9px] text-slate-400">{label}</p>
      <p className={`${bold ? "text-base font-black" : "text-xs font-bold"}`} style={{ color: color ?? "#1e293b" }}>
        {value}
      </p>
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
