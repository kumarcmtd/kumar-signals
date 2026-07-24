import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Target, Wallet, Trophy, Sparkles } from "lucide-react";
import { usePortfolio } from "../api/hooks";
import { useTimeframeSuite, TIMEFRAMES } from "../hooks/useTimeframeSuite";
import { useTradeLog } from "../hooks/useTradeLog";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { exitPriceFor } from "../utils/tradeLogPnl";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const SYMBOLS: TradableSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const LOT_SIZE: Record<TradableSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250 };
const SYMBOL_COLOR: Record<TradableSymbol, { from: string; to: string; text: string }> = {
  CRUDEOIL: { from: "#F59E0B", to: "#EF4444", text: "#B45309" },
  NATURALGAS: { from: "#3B82F6", to: "#06B6D4", text: "#1D4ED8" },
};

interface PremiumProjection {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  targets: [number, number, number];
  stop: number;
}

function projectPremium(analysis: ReturnType<typeof useTimeframeSuite>["analyses"][number], options: ReturnType<typeof useTimeframeSuite>["options"]): PremiumProjection | null {
  if (!options || options.error || !analysis.optSide || analysis.underlyingEntry === null || analysis.underlyingStop === null || !analysis.underlyingTargets) {
    return null;
  }
  const row = options.rows.find((r) => r.strike === options.atmStrike) ?? options.rows[Math.floor(options.rows.length / 2)];
  if (!row) return null;
  const leg = analysis.optSide === "CE" ? row.call : row.put;
  if (leg.ltp === null || leg.ltp <= 0) return null;
  const DELTA = 0.5;
  const favMove = Math.abs(analysis.underlyingTargets[0] - analysis.underlyingEntry);
  const riskMove = Math.abs(analysis.underlyingEntry - analysis.underlyingStop);
  const entry = leg.ltp;
  const targets: [number, number, number] = [
    Number((entry + DELTA * favMove).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[1] - analysis.underlyingEntry)).toFixed(2)),
    Number((entry + DELTA * Math.abs(analysis.underlyingTargets[2] - analysis.underlyingEntry)).toFixed(2)),
  ];
  const stop = Number(Math.max(entry * 0.35, entry - DELTA * riskMove).toFixed(2));
  return { strike: row.strike, optSide: analysis.optSide, entry, targets, stop };
}

// Converts a closed trade's point gain/loss into a real rupee amount using
// the SAME fixed-risk position sizing already used on the Risk page:
// quantity is sized so this one trade's stop-loss distance risks exactly
// `riskPercent` of `capital`, not a flat lot count. A wider stop -> smaller
// quantity, matching how real position sizing actually works.
function amountFor(entry: TradeLogEntry, lotSize: number, capital: number, riskPercent: number): number | null {
  if (!entry.closed) return null;
  const perUnitRisk = Math.abs(entry.entry - entry.stop);
  if (perUnitRisk <= 0) return null;
  const riskAmount = (capital * riskPercent) / 100;
  const quantity = Math.max(1, Math.floor(riskAmount / perUnitRisk / lotSize));
  const pnlPoints = exitPriceFor(entry) - entry.entry;
  return Number((pnlPoints * lotSize * quantity).toFixed(0));
}

interface RowStats {
  tf: string;
  label: string;
  suggested: number;
  targetHit: number;
  breakeven: number;
  slHit: number;
  running: number;
  netPoints: number;
  amount: number;
}

interface TimeframeRank extends RowStats {
  closed: number;
  winRatePct: number | null;
}

// Medal styling for the top 3 by rank; anything past 3rd gets a plain slate
// badge. Rank 1 also gets a warm gold card background so it stands out at a
// glance without needing to read the numbers first.
const RANK_STYLE: { ring: string; badgeBg: string; badgeText: string; label: string }[] = [
  { ring: "#F59E0B", badgeBg: "linear-gradient(135deg,#FBBF24,#F59E0B)", badgeText: "#78350F", label: "1st" },
  { ring: "#94A3B8", badgeBg: "linear-gradient(135deg,#E2E8F0,#94A3B8)", badgeText: "#334155", label: "2nd" },
  { ring: "#C2703D", badgeBg: "linear-gradient(135deg,#F0B27A,#B5651D)", badgeText: "#4A2511", label: "3rd" },
  { ring: "#CBD5E1", badgeBg: "#F1F5F9", badgeText: "#64748B", label: "4th" },
];

function summarize(entries: TradeLogEntry[], lotSize: number, capital: number, riskPercent: number): { targetHit: number; breakeven: number; slHit: number; running: number; netPoints: number; amount: number } {
  let targetHit = 0,
    breakeven = 0,
    slHit = 0,
    running = 0,
    netPoints = 0,
    amount = 0;
  for (const e of entries) {
    if (!e.closed) {
      running++;
      continue;
    }
    if (e.status === "target3_hit" || e.status === "stopped_after_t1") targetHit++;
    else if (e.status === "stopped_breakeven") breakeven++;
    else if (e.status === "sl_hit") slHit++;
    netPoints += exitPriceFor(e) - e.entry;
    amount += amountFor(e, lotSize, capital, riskPercent) ?? 0;
  }
  return { targetHit, breakeven, slHit, running, netPoints: Number(netPoints.toFixed(2)), amount: Math.round(amount) };
}

export function TradeReport() {
  const { data: trades } = usePortfolio();
  const { risk, setRisk } = useAppStore();
  const [capitalInput, setCapitalInput] = useState(String(risk.capital));
  const [riskPctInput, setRiskPctInput] = useState(String(risk.riskPercent));

  const journalSummary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const crudeOil = useTimeframeSuite("CRUDEOIL", journalSummary.winRate);
  const naturalGas = useTimeframeSuite("NATURALGAS", journalSummary.winRate);

  const crudeOilProjections = useMemo(() => crudeOil.analyses.map((a) => projectPremium(a, crudeOil.options)), [crudeOil.analyses, crudeOil.options]);
  const naturalGasProjections = useMemo(() => naturalGas.analyses.map((a) => projectPremium(a, naturalGas.options)), [naturalGas.analyses, naturalGas.options]);
  // Drives the SAME shared trade log this page reads from -- keeps ticking
  // even if this is the only AI page currently open.
  useTradeLog("CRUDEOIL", crudeOil.analyses, crudeOilProjections, crudeOil.options);
  const tradeLogs = useTradeLog("NATURALGAS", naturalGas.analyses, naturalGasProjections, naturalGas.options);

  const capital = Number(capitalInput) || 0;
  const riskPercent = Number(riskPctInput) || 0;

  const rowsBySymbol = useMemo(() => {
    const out: Record<TradableSymbol, RowStats[]> = { CRUDEOIL: [], NATURALGAS: [] };
    for (const symbol of SYMBOLS) {
      for (const { tf, label } of TIMEFRAMES) {
        const entries = tradeLogs[`${symbol}-${tf}`] ?? [];
        const s = summarize(entries, LOT_SIZE[symbol], capital, riskPercent);
        out[symbol].push({ tf, label, suggested: entries.length, ...s });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeLogs, capital, riskPercent]);

  // Combines both symbols per timeframe (a 1-hour signal on Crude Oil and a
  // 1-hour signal on Natural Gas are both "the 1-hour timeframe") and ranks
  // by net rupee P&L -- the same real, already-computed numbers shown in the
  // per-symbol tables below, just aggregated to answer "which timeframe
  // should I actually trade" at a glance.
  const timeframeRanking = useMemo<TimeframeRank[]>(() => {
    return TIMEFRAMES.map(({ tf, label }) => {
      const cRow = rowsBySymbol.CRUDEOIL.find((r) => r.tf === tf);
      const nRow = rowsBySymbol.NATURALGAS.find((r) => r.tf === tf);
      const suggested = (cRow?.suggested ?? 0) + (nRow?.suggested ?? 0);
      const targetHit = (cRow?.targetHit ?? 0) + (nRow?.targetHit ?? 0);
      const breakeven = (cRow?.breakeven ?? 0) + (nRow?.breakeven ?? 0);
      const slHit = (cRow?.slHit ?? 0) + (nRow?.slHit ?? 0);
      const running = (cRow?.running ?? 0) + (nRow?.running ?? 0);
      const netPoints = Number(((cRow?.netPoints ?? 0) + (nRow?.netPoints ?? 0)).toFixed(2));
      const amount = (cRow?.amount ?? 0) + (nRow?.amount ?? 0);
      const closed = targetHit + breakeven + slHit;
      const winRatePct = closed > 0 ? Math.round((targetHit / closed) * 100) : null;
      return { tf, label, suggested, targetHit, breakeven, slHit, running, netPoints, amount, closed, winRatePct };
    }).sort((a, b) => b.amount - a.amount);
  }, [rowsBySymbol]);

  const maxRankAmount = Math.max(1, ...timeframeRanking.map((r) => Math.abs(r.amount)));

  const grandTotal = useMemo(() => {
    const all = [...rowsBySymbol.CRUDEOIL, ...rowsBySymbol.NATURALGAS];
    return all.reduce(
      (acc, r) => ({
        suggested: acc.suggested + r.suggested,
        targetHit: acc.targetHit + r.targetHit,
        breakeven: acc.breakeven + r.breakeven,
        slHit: acc.slHit + r.slHit,
        running: acc.running + r.running,
        amount: acc.amount + r.amount,
      }),
      { suggested: 0, targetHit: 0, breakeven: 0, slHit: 0, running: 0, amount: 0 }
    );
  }, [rowsBySymbol]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#F5F7FF,#FFFFFF 30%)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <h1 className="text-2xl font-black tracking-tight bg-gradient-to-r from-indigo-600 via-fuchsia-500 to-orange-500 bg-clip-text text-transparent">Trade Report</h1>
        <p className="text-xs text-slate-500 px-4">Crude Oil &amp; Natural Gas, every timeframe — how many signals hit target vs stop-loss, and what that means in real rupees.</p>
      </section>

      {/* CAPITAL INPUT */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
          <Wallet size={14} /> If I invest...
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] text-slate-400">Capital (₹)</span>
            <input
              type="number"
              value={capitalInput}
              onChange={(e) => {
                setCapitalInput(e.target.value);
                setRisk({ capital: Number(e.target.value) || 0 });
              }}
              className="w-full mt-0.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-bold text-slate-800"
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-slate-400">Risk per trade (%)</span>
            <input
              type="number"
              value={riskPctInput}
              onChange={(e) => {
                setRiskPctInput(e.target.value);
                setRisk({ riskPercent: Number(e.target.value) || 0 });
              }}
              className="w-full mt-0.5 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-bold text-slate-800"
            />
          </label>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">Same settings as the Risk page — quantity per trade is sized so its own stop-loss distance risks this % of capital, not a flat lot count.</p>
      </section>

      {/* TIMEFRAME RANKING */}
      <section className="rounded-2xl bg-white shadow-md border border-slate-100 p-4">
        <p className="text-xs font-bold uppercase text-slate-400 mb-1 flex items-center gap-1.5">
          <Trophy size={14} className="text-amber-500" /> Timeframe Ranking — Overall Net
        </p>
        <p className="text-[10px] text-slate-400 mb-3">Ranked by combined net ₹ P&amp;L across Crude Oil + Natural Gas — use this to decide which timeframe to actually trade.</p>

        {grandTotal.suggested === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No signals yet — rankings will appear once calls start firing and closing.</p>
        ) : (
          <div className="space-y-2.5">
            {timeframeRanking.map((r, i) => {
              const style = RANK_STYLE[i] ?? RANK_STYLE[RANK_STYLE.length - 1];
              const barPct = Math.max(4, (Math.abs(r.amount) / maxRankAmount) * 100);
              return (
                <div
                  key={r.tf}
                  className="rounded-xl p-3 border"
                  style={{ borderColor: `${style.ring}55`, background: i === 0 ? "linear-gradient(135deg,#FFFBEB,#FFFFFF)" : "#FAFAFA" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center font-black text-[11px] shrink-0"
                        style={{ background: style.badgeBg, color: style.badgeText }}
                      >
                        {i === 0 ? <Trophy size={15} /> : style.label}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800 truncate">{r.label}</p>
                        <p className="text-[10px] text-slate-400">
                          {r.suggested} signals · {r.closed} closed{r.running ? ` · ${r.running} running` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black" style={{ color: r.amount >= 0 ? "#16A34A" : "#DC2626" }}>
                        {r.amount >= 0 ? "+" : ""}₹{r.amount.toLocaleString("en-IN")}
                      </p>
                      {r.winRatePct !== null && <p className="text-[10px] font-semibold text-slate-400">{r.winRatePct}% win rate</p>}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, background: r.amount >= 0 ? "linear-gradient(90deg,#4ADE80,#16A34A)" : "linear-gradient(90deg,#F87171,#DC2626)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[10px] text-slate-400 mt-3 flex items-start gap-1.5">
          <Sparkles size={11} className="mt-0.5 shrink-0" /> Based on actual closed-trade history so far, not a prediction — rankings will shift as more trades close.
        </p>
      </section>

      {/* GRAND TOTAL */}
      <section className="rounded-2xl p-5 text-white shadow-lg" style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED,#DB2777)" }}>
        <p className="text-[11px] font-bold uppercase opacity-80">Overall — Both Instruments, All Timeframes</p>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <MiniStat label="Suggested" value={String(grandTotal.suggested)} />
          <MiniStat label="Target Hit" value={String(grandTotal.targetHit)} accent="#4ADE80" />
          <MiniStat label="SL Hit" value={String(grandTotal.slHit)} accent="#FCA5A5" />
          <MiniStat label="Breakeven" value={String(grandTotal.breakeven)} accent="#FDE68A" />
          <MiniStat label="Running" value={String(grandTotal.running)} />
          <MiniStat label="Total Amount" value={`${grandTotal.amount >= 0 ? "+" : ""}₹${grandTotal.amount.toLocaleString("en-IN")}`} accent={grandTotal.amount >= 0 ? "#4ADE80" : "#FCA5A5"} />
        </div>
      </section>

      {/* PER-SYMBOL TABLES */}
      {SYMBOLS.map((symbol) => {
        const colors = SYMBOL_COLOR[symbol];
        const rows = rowsBySymbol[symbol];
        const symbolTotal = rows.reduce((s, r) => s + r.amount, 0);
        return (
          <section key={symbol} className="rounded-2xl bg-white shadow-md border border-slate-100 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: `linear-gradient(90deg,${colors.from},${colors.to})` }}>
              <p className="text-sm font-black text-white">{DISPLAY_NAME[symbol]}</p>
              <p className="text-sm font-black text-white">
                {symbolTotal >= 0 ? "+" : ""}₹{symbolTotal.toLocaleString("en-IN")}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[640px]">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-100">
                    <th className="font-semibold py-2 px-3">Timeframe</th>
                    <th className="font-semibold py-2 px-3">Suggested</th>
                    <th className="font-semibold py-2 px-3">Target Hit</th>
                    <th className="font-semibold py-2 px-3">Breakeven</th>
                    <th className="font-semibold py-2 px-3">SL Hit</th>
                    <th className="font-semibold py-2 px-3">Running</th>
                    <th className="font-semibold py-2 px-3">Net Points</th>
                    <th className="font-semibold py-2 px-3">Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tf} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 px-3 font-bold text-slate-700">{r.label}</td>
                      <td className="py-2.5 px-3 text-slate-600">{r.suggested}</td>
                      <td className="py-2.5 px-3">
                        <Badge color="#16A34A" bg="#DCFCE7">
                          <TrendingUp size={11} /> {r.targetHit}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge color="#B45309" bg="#FEF3C7">
                          {r.breakeven}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge color="#DC2626" bg="#FEE2E2">
                          <TrendingDown size={11} /> {r.slHit}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{r.running}</td>
                      <td className="py-2.5 px-3 font-semibold" style={{ color: r.netPoints >= 0 ? "#16A34A" : "#DC2626" }}>
                        {r.netPoints >= 0 ? "+" : ""}
                        {r.netPoints}
                      </td>
                      <td className="py-2.5 px-3 font-black" style={{ color: r.amount >= 0 ? "#16A34A" : "#DC2626" }}>
                        {r.amount >= 0 ? "+" : ""}₹{r.amount.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2 flex items-center justify-center gap-1">
        <Target size={11} /> Amounts only cover CLOSED trades (target hit, stopped, or SL hit) — still-running ones aren't counted until they finish. Educational reference only, not financial advice.
      </p>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2">
      <p className="text-[9px] opacity-70">{label}</p>
      <p className="text-sm font-black" style={{ color: accent ?? "#FFFFFF" }}>
        {value}
      </p>
    </div>
  );
}

function Badge({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold" style={{ color, background: bg }}>
      {children}
    </span>
  );
}
