import { History } from "lucide-react";
import type { VerifyProTrackRecord } from "../utils/verifyProTrackRecord";

const CHECK_NAME: Record<string, string> = {
  supertrend: "Double SuperTrend",
  ema200: "200 EMA Trend Filter",
  vwap: "VWAP Confirmation",
  adx: "ADX Strength",
  rsi: "RSI Confirmation",
  macd: "MACD",
  volume: "Volume Confirmation",
  cpr: "CPR Analysis",
  sr: "Support/Resistance",
  atrStop: "ATR Stop Validation",
  oi: "Open Interest Confirmation",
  premiumMomentum: "Premium Momentum",
  marketDepth: "Market Depth & Smart Money",
  marketStructure: "Market Structure (SMC)",
  smartMoneyFlags: "Smart Money Flags",
  candlePattern: "Candle Pattern",
  orderFlow: "Order Flow",
  pcr: "PCR Sentiment",
  oiBuildup: "OI Build-up",
  maxPain: "Max Pain Distance",
};

// This is a report card, not a control panel -- nothing here feeds back
// into the engine automatically. It starts empty and only becomes
// meaningful after real Best Call trades for this symbol have closed.
export function VerifyProTrackRecordCard({ track }: { track: VerifyProTrackRecord }) {
  const { performance: p } = track;
  const lossRatePct = p.accuracyPct !== null ? 100 - p.accuracyPct : null;

  return (
    <div className="card p-4">
      <p className="text-xs font-black uppercase text-[var(--color-muted)] mb-3 flex items-center gap-1.5">
        <History size={13} />
        Self-Learning Track Record
      </p>

      {p.totalClosed === 0 ? (
        <p className="text-[11.5px] text-[var(--color-muted)]">No closed Best Call trades for this symbol yet -- this report fills in as real trades complete. Track-only: it never changes how the engine scores a trade.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3 text-center">
            <TrackStat label="Win Rate" value={p.accuracyPct !== null ? `${p.accuracyPct}%` : "—"} />
            <TrackStat label="Loss Rate" value={lossRatePct !== null ? `${lossRatePct}%` : "—"} />
            <TrackStat label="Avg RR" value={p.avgWin !== null && p.avgLoss !== null && p.avgLoss > 0 ? `1:${(p.avgWin / p.avgLoss).toFixed(1)}` : "—"} />
            <TrackStat label="Max Drawdown" value={`₹${p.maxDrawdown.toFixed(1)}`} />
          </div>
          <p className="text-[10px] text-[var(--color-muted)] mb-3">
            {p.totalClosed} closed trade{p.totalClosed === 1 ? "" : "s"} for this symbol · {p.wins}W / {p.losses}L
            {p.breakevens > 0 ? ` / ${p.breakevens} BE` : ""}.
          </p>

          {track.checkAccuracy.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase text-[var(--color-muted)]">Indicator Accuracy (when PASS, win rate was...)</p>
              {track.checkAccuracy
                .filter((c) => c.passWinRatePct !== null)
                .map((c) => (
                  <div key={c.key} className="flex justify-between text-[10.5px]">
                    <span className="text-[var(--color-muted)]">{CHECK_NAME[c.key] ?? c.key}</span>
                    <span className="font-bold" style={{ color: (c.passWinRatePct ?? 0) >= 55 ? "var(--color-buy)" : "var(--color-sell)" }}>
                      {c.passWinRatePct}% ({c.passSamples} trades)
                    </span>
                  </div>
                ))}
              {track.checkAccuracy.every((c) => c.passWinRatePct === null) && <p className="text-[10.5px] text-[var(--color-muted)]">Not enough closed trades per check yet to show individual accuracy.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrackStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-2 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-border)" }}>
      <p className="text-[8px] text-[var(--color-muted)] uppercase">{label}</p>
      <p className="text-[11px] font-bold mt-0.5">{value}</p>
    </div>
  );
}
