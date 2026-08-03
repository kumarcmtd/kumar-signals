import { Activity } from "lucide-react";
import type { StrategyResult, CallDirection } from "../utils/strategyVerification";
import type { MarketDepthResult } from "../utils/marketDepthAnalysis";

// A purely presentational rollup of checks this page has already computed
// (Strategy Checklist + Market Depth) into the plain-English summary a
// trading-desk "market health" panel usually shows -- no new data source,
// just a friendlier read of numbers already on this page.
export function MarketHealthCard({ strategies, depth, direction }: { strategies: StrategyResult[]; depth: MarketDepthResult | null; direction: CallDirection }) {
  const byKey = (key: string) => strategies.find((s) => s.key === key);
  const dirWord = direction === "bullish" ? "Bullish" : "Bearish";

  const trendChecks = ["supertrend", "ema200", "vwap"].map((k) => byKey(k)?.tier);
  const trendPassCount = trendChecks.filter((t) => t === "pass").length;
  const trend = trendPassCount >= 3 ? `Strong ${dirWord}` : trendPassCount >= 2 ? dirWord : "Mixed";

  const adxTier = byKey("adx")?.tier;
  const momentum = adxTier === "pass" ? "Strong" : adxTier === "wait" ? "Moderate" : "Weak";

  const liquidity = depth ? (depth.liquidityScore >= 7 ? "Excellent" : depth.liquidityScore >= 4 ? "Good" : "Thin") : "Unknown";

  const volumeTier = byKey("volume")?.tier;
  const volume = volumeTier === "pass" ? "High" : volumeTier === "wait" ? "Average" : "Low";

  const atrTier = byKey("atrStop")?.tier;
  const volatility = atrTier === "fail" ? "Low" : atrTier === "pass" ? "Medium" : "High";

  const institutionActivity = depth
    ? depth.smartMoney.some((f) => f.kind === "positive" && f.key !== "clean")
      ? "Buying"
      : depth.smartMoney.some((f) => f.kind === "caution")
        ? "Selling"
        : "Neutral"
    : "Unknown";
  // Rough complementary read, not a distinct signal of its own -- retail
  // flow isn't something this app can actually observe separately from
  // institutional flow with the data available.
  const retailActivity = institutionActivity === "Buying" ? "Selling" : institutionActivity === "Selling" ? "Buying" : "Mixed";

  const passCount = strategies.filter((s) => s.tier === "pass").length;
  const failCount = strategies.filter((s) => s.tier === "fail").length;
  const healthy = passCount >= strategies.length * 0.6 && failCount <= 2;
  const overall = healthy
    ? { emoji: "🟢", label: "HEALTHY TREND", color: "#15803D" }
    : failCount > passCount
      ? { emoji: "🔴", label: "WEAK / AVOID", color: "#B91C1C" }
      : { emoji: "🟡", label: "CHOPPY / MIXED", color: "#B45309" };

  return (
    <div className="card p-4">
      <p className="text-xs font-black uppercase text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
        <Activity size={13} />
        Market Health
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <HealthStat label="Trend" value={trend} />
        <HealthStat label="Momentum" value={momentum} />
        <HealthStat label="Liquidity" value={liquidity} />
        <HealthStat label="Volume" value={volume} />
        <HealthStat label="Volatility" value={volatility} />
        <HealthStat label="Institution Activity" value={institutionActivity} />
        <HealthStat label="Retail Activity" value={retailActivity} />
      </div>
      <div className="rounded-xl px-3 py-2.5 text-center" style={{ background: `${overall.color}15` }}>
        <p className="text-sm font-black" style={{ color: overall.color }}>
          {overall.emoji} {overall.label}
        </p>
      </div>
    </div>
  );
}

function HealthStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[8px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-[11px] font-bold mt-0.5">{value}</p>
    </div>
  );
}
