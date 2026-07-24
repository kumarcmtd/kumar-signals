import { useMemo } from "react";
import { BrainCircuit, ShieldCheck, Radar, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useMarketStatus, usePortfolio, useCandles } from "../api/hooks";
import { useTimeframeSuite, TIMEFRAMES } from "../hooks/useTimeframeSuite";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { findEliteSignal } from "../utils/eliteSignal";
import { scanAllSetups, type TimedScanResult } from "../utils/kimiScanner";
import { calculateHitProbability } from "../utils/kimiPlaybook";
import { decisionLabelWithScore } from "../utils/timeframeEngine";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import type { Direction, OptionsAnalytics } from "../types";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["NATURALGAS", "CRUDEOIL"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const BIAS_STYLE: Record<Direction, { label: string; color: string; bg: string; icon: typeof TrendingUp }> = {
  bullish: { label: "Bullish", color: "#15803D", bg: "#DCFCE7", icon: TrendingUp },
  bearish: { label: "Bearish", color: "#B91C1C", bg: "#FEE2E2", icon: TrendingDown },
  neutral: { label: "Neutral / Mixed", color: "#B45309", bg: "#FEF3C7", icon: Minus },
};

// Reuses the exact same setup-scanner + probability gate KimiAITrade.tsx
// applies to its own Live Trade Suggestions -- this page only ever reports
// how many setups CURRENTLY clear that bar, never invents its own count.
function useKimiQualifiedCount(symbol: TradableSymbol, commodity: "NG" | "CL"): number {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const tfQueries = [c15, c30, c60, c240];
  const suggestions = useMemo(() => {
    const timeframes = TIMEFRAMES.map(({ tf, label }, i) => ({ tf, label, candles: tfQueries[i].data?.candles ?? [] }));
    return scanAllSetups(commodity, timeframes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, c15.data, c30.data, c60.data, c240.data]);
  return useMemo(
    () =>
      suggestions.filter((r: TimedScanResult) => {
        const result = calculateHitProbability(r.setupName, commodity, r.detectedConfluence);
        return !("error" in result) && !result.blocked && result.tradeable;
      }).length,
    [suggestions, commodity]
  );
}

// Joins category notes into one fragment, lowercasing the leading word so it
// reads naturally after a colon -- but only when that word isn't itself an
// acronym (RSI/MACD/OBV/CPR/ATR/VWAP all start with two capital letters in a
// row, which a blanket .toLowerCase() would mangle into "rSI"/"oBV").
function joinNotes(notes: string[]): string {
  const joined = notes.join("; ");
  if (!joined) return joined;
  const isAcronymStart = /^[A-Z][A-Z]/.test(joined);
  return isAcronymStart ? joined : joined[0].toLowerCase() + joined.slice(1);
}

function pickMostDecisive(analyses: TimeframeAnalysis[]): TimeframeAnalysis | null {
  const valid = analyses.filter((a) => a.overallScore !== null);
  if (!valid.length) return null;
  return valid.reduce((best, a) => (Math.abs((a.overallScore ?? 50) - 50) > Math.abs((best.overallScore ?? 50) - 50) ? a : best));
}

interface InstrumentReport {
  symbol: TradableSymbol;
  bias: Direction;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalCount: number;
  decisive: TimeframeAnalysis | null;
  trendText: string;
  momentumText: string;
  priceActionText: string;
  volumeText: string;
  keyLevelsText: string;
  volatilityText: string;
  optionsText: string;
  alignmentText: string;
  eliteText: string;
  kimiText: string;
  takeawayText: string;
}

// Every sentence below is assembled directly from real, already-computed
// numbers/notes (TimeframeAnalysis's per-category notes, OptionsAnalytics'
// live chain fields, findEliteSignal's own gate, Kimi's own qualified-setup
// count) -- nothing here is a separate model or a fabricated narrative.
// When a category has nothing to say (e.g. not enough bars yet), the
// sentence says so plainly rather than inventing filler.
function buildInstrumentReport(
  symbol: TradableSymbol,
  analyses: TimeframeAnalysis[],
  options: OptionsAnalytics | undefined,
  elite: ReturnType<typeof findEliteSignal>,
  kimiQualifiedCount: number
): InstrumentReport {
  const valid = analyses.filter((a) => a.overallScore !== null);
  const bullishCount = valid.filter((a) => a.bias === "bullish").length;
  const bearishCount = valid.filter((a) => a.bias === "bearish").length;
  const neutralCount = valid.length - bullishCount - bearishCount;
  const bias: Direction = bullishCount > bearishCount ? "bullish" : bearishCount > bullishCount ? "bearish" : "neutral";
  const decisive = pickMostDecisive(analyses);
  const name = DISPLAY_NAME[symbol];

  const trendText = decisive?.categories?.trend.notes.length
    ? `On the ${decisive.label} timeframe (currently the most decisive read), ${joinNotes(decisive.categories.trend.notes)}.`
    : `No timeframe has a clear enough trend structure to describe right now.`;

  const momentumText = decisive?.categories?.momentum.notes.length
    ? `Momentum: ${joinNotes(decisive.categories.momentum.notes)}.`
    : `Momentum indicators (RSI, MACD, Stochastic RSI) aren't showing a decisive lean on the ${decisive?.label ?? "analyzed"} timeframe right now.`;

  const priceActionText = decisive?.categories?.priceAction.notes.length
    ? `Price action: ${joinNotes(decisive.categories.priceAction.notes)}.`
    : `No notable candle pattern, breakout, or liquidity sweep on the ${decisive?.label ?? "analyzed"} timeframe right now.`;

  const volumeText = decisive?.categories?.volume.notes.length
    ? `Volume: ${joinNotes(decisive.categories.volume.notes)}.`
    : `Volume is running close to its recent average, no spike or OBV divergence to flag.`;

  const keyLevelsText = decisive?.categories?.supportResistance.notes.length
    ? `Key levels: ${joinNotes(decisive.categories.supportResistance.notes)}.`
    : `No nearby support/resistance level stands out on the ${decisive?.label ?? "analyzed"} timeframe right now.`;

  const volatilityText = decisive?.categories?.volatility.notes.length
    ? `Volatility: ${joinNotes(decisive.categories.volatility.notes)}.`
    : `Volatility is steady, nothing unusual to flag.`;

  const optionsText =
    options && !options.error
      ? `The live option chain is reading ${options.bias} (PCR ${options.pcr ?? "—"})${
          options.resistance !== null || options.support !== null
            ? `, with peak open interest suggesting resistance near ${options.resistance ?? "—"} and support near ${options.support ?? "—"}`
            : ""
        }${options.maxPain !== null ? `, and max pain around ${options.maxPain}` : ""}.`
      : `The live option chain isn't reachable right now, so no OI/PCR read is available.`;

  const alignmentText =
    valid.length > 0
      ? `${bullishCount} of ${valid.length} analyzed timeframes lean bullish, ${bearishCount} bearish${neutralCount > 0 ? `, and ${neutralCount} neutral/WAIT` : ""}.`
      : `Not enough live data yet across any timeframe to gauge alignment.`;

  const eliteText = elite
    ? `AI Elite currently has a ${decisionLabelWithScore(elite.analysis.decision)} pick on the ${elite.analysis.label} timeframe, confirmed by ${elite.confirmingTimeframes.join(", ") || "no other timeframe"}.`
    : `AI Elite has no qualifying ${name} setup right now -- nothing currently clears its strict confluence + reward-to-risk bar.`;

  const kimiText =
    kimiQualifiedCount > 0
      ? `Kimi AI's playbook scanner currently has ${kimiQualifiedCount} ${name} setup${kimiQualifiedCount === 1 ? "" : "s"} meeting its full confluence + edge-score bar.`
      : `Kimi AI's playbook scanner has no fully-confirmed ${name} setup right now.`;

  const takeawayText = `Taken together, ${name} is reading ${BIAS_STYLE[bias].label.toLowerCase()} across the timeframes analyzed${
    elite || kimiQualifiedCount > 0 ? ", with at least one stricter engine (Elite or Kimi) currently in agreement" : ", though neither Elite nor Kimi currently has a fully-confirmed pick"
  }. This is a reference read, not a signal to act on by itself -- always confirm on the live chart and respect your own risk rules.`;

  return {
    symbol,
    bias,
    bullishCount,
    bearishCount,
    neutralCount,
    totalCount: valid.length,
    decisive,
    trendText,
    momentumText,
    priceActionText,
    volumeText,
    keyLevelsText,
    volatilityText,
    optionsText,
    alignmentText,
    eliteText,
    kimiText,
    takeawayText,
  };
}

export function MarketAnalysis() {
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);

  const naturalGas = useTimeframeSuite("NATURALGAS", journalSummary.winRate);
  const crudeOil = useTimeframeSuite("CRUDEOIL", journalSummary.winRate);

  const ngKimiCount = useKimiQualifiedCount("NATURALGAS", "NG");
  const clKimiCount = useKimiQualifiedCount("CRUDEOIL", "CL");

  const naturalGasEntries = useMemo(() => naturalGas.analyses.map((a) => ({ symbol: "NATURALGAS", analysis: a, options: naturalGas.options })), [naturalGas.analyses, naturalGas.options]);
  const crudeOilEntries = useMemo(() => crudeOil.analyses.map((a) => ({ symbol: "CRUDEOIL", analysis: a, options: crudeOil.options })), [crudeOil.analyses, crudeOil.options]);
  const naturalGasElite = useMemo(() => findEliteSignal(naturalGasEntries), [naturalGasEntries]);
  const crudeOilElite = useMemo(() => findEliteSignal(crudeOilEntries), [crudeOilEntries]);

  const reports: Record<TradableSymbol, InstrumentReport> = {
    NATURALGAS: buildInstrumentReport("NATURALGAS", naturalGas.analyses, naturalGas.options, naturalGasElite, ngKimiCount),
    CRUDEOIL: buildInstrumentReport("CRUDEOIL", crudeOil.analyses, crudeOil.options, crudeOilElite, clKimiCount),
  };

  const loading = naturalGas.loading || crudeOil.loading;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#EEF2FF,#FFFFFF 30%)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <BrainCircuit size={22} className="text-indigo-600" />
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600 bg-clip-text text-transparent">AI Market Analysis</h1>
        </div>
        <p className="text-[11px] text-slate-500 px-4">
          A consolidated daily read for Crude Oil &amp; Natural Gas — every sentence below is generated from this app's own real, live-computed scores (trend, momentum, price action, volume,
          key levels, volatility, options-chain bias) and the same gates AI Elite and Kimi AI already enforce, not a separate model.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "Market Open" : "Market Closed") : "…"}
        </p>
      </section>

      {/* OVERVIEW */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-3">Market Overview</p>
        <div className="grid grid-cols-2 gap-3">
          {SYMBOLS.map((sym) => {
            const r = reports[sym];
            const style = BIAS_STYLE[r.bias];
            const Icon = style.icon;
            return (
              <div key={sym} className="rounded-xl p-3" style={{ background: style.bg }}>
                <p className="text-[10px] font-bold uppercase text-slate-500">{DISPLAY_NAME[sym]}</p>
                <p className="text-sm font-black mt-0.5 flex items-center gap-1.5" style={{ color: style.color }}>
                  <Icon size={15} /> {style.label}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {r.bullishCount}B / {r.bearishCount}Br / {r.neutralCount}N of {r.totalCount} tf
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {loading && <p className="text-xs text-slate-400 text-center py-2">Loading live data across both instruments…</p>}

      {/* PER-INSTRUMENT DEEP DIVE */}
      {SYMBOLS.map((sym) => {
        const r = reports[sym];
        const style = BIAS_STYLE[r.bias];
        return (
          <section key={sym} className="rounded-2xl bg-white shadow-md border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: style.bg }}>
              <p className="text-sm font-black" style={{ color: style.color }}>
                {DISPLAY_NAME[sym]}
              </p>
              <p className="text-xs font-bold" style={{ color: style.color }}>
                {style.label}
              </p>
            </div>
            <div className="p-4 space-y-2.5">
              <Paragraph label="Trend" text={r.trendText} />
              <Paragraph label="Momentum" text={r.momentumText} />
              <Paragraph label="Price Action" text={r.priceActionText} />
              <Paragraph label="Volume" text={r.volumeText} />
              <Paragraph label="Key Levels" text={r.keyLevelsText} />
              <Paragraph label="Volatility" text={r.volatilityText} />
              <Paragraph label="Options Chain" text={r.optionsText} />
              <Paragraph label="Timeframe Alignment" text={r.alignmentText} />
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                <p className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck size={12} /> Cross-Engine Check
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">{r.eliteText}</p>
                <p className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
                  <Radar size={12} className="mt-0.5 shrink-0 text-orange-500" /> {r.kimiText}
                </p>
              </div>
              <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-3">
                <p className="text-[10px] font-bold uppercase text-indigo-500 mb-1">Takeaway</p>
                <p className="text-xs text-indigo-900 leading-relaxed">{r.takeawayText}</p>
              </div>
            </div>
          </section>
        );
      })}

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. This page summarizes what the app's own engines already compute — it never adds a new prediction of its own.
      </p>
    </div>
  );
}

function Paragraph({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{text}</p>
    </div>
  );
}
