import type { MasterAIResult } from "../utils/masterEngine";
import type { InstrumentSymbol } from "../types";

const DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "CRUDE OIL", NATURALGAS: "NATURAL GAS" };

export interface ScoreBoardEntry {
  symbol: InstrumentSymbol;
  result: MasterAIResult | null;
  loading: boolean;
  unavailable: boolean;
}

function tagFor(result: MasterAIResult | null): { label: string; color: string } {
  if (!result || result.bias === "neutral" || result.overallScore < 70) return { label: "NO TRADE", color: "bg-slate-400" };
  if (result.overallScore >= 90) return { label: result.bias === "bullish" ? "STRONG BUY" : "STRONG SELL", color: result.bias === "bullish" ? "bg-emerald-600" : "bg-rose-600" };
  if (result.overallScore >= 80) return { label: result.bias === "bullish" ? "BUY" : "SELL", color: result.bias === "bullish" ? "bg-emerald-500" : "bg-rose-500" };
  return { label: "WAIT", color: "bg-amber-500" };
}

export function marketMood(entries: ScoreBoardEntry[]): string | null {
  const results = entries.map((e) => e.result).filter((r): r is MasterAIResult => r !== null);
  if (!results.length) return null;

  const bullish = results.filter((r) => r.bias === "bullish").length;
  const bearish = results.filter((r) => r.bias === "bearish").length;
  let sentiment = "Mixed";
  if (bullish > 0 && bearish === 0) sentiment = bullish === results.length ? "Broadly Bullish" : "Leaning Bullish";
  else if (bearish > 0 && bullish === 0) sentiment = bearish === results.length ? "Broadly Bearish" : "Leaning Bearish";
  else if (bullish === 0 && bearish === 0) sentiment = "Neutral";

  const avgVol = results.reduce((s, r) => s + r.meters.volatility.score, 0) / results.length;
  const volLabel = avgVol >= 65 ? "expanding volatility" : avgVol <= 40 ? "compressing volatility" : "normal volatility";
  return `${sentiment} · ${volLabel}`;
}

export function ScoreBoard<S extends InstrumentSymbol>({
  entries,
  selected,
  onSelect,
}: {
  entries: { symbol: S; result: MasterAIResult | null; loading: boolean; unavailable: boolean }[];
  selected: S;
  onSelect: (s: S) => void;
}) {
  const ranked = [...entries].sort((a, b) => (b.result?.overallScore ?? -1) - (a.result?.overallScore ?? -1));

  return (
    <div className="rounded-2xl bg-white/80 backdrop-blur border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)]">
      {ranked.map((e, i) => {
        const tag = tagFor(e.result);
        const isSelected = e.symbol === selected;
        const topReason = e.result?.reasons[0];
        const statusText = e.loading ? "Loading…" : e.unavailable ? "Live data unavailable" : topReason ?? "No strong confluence yet";
        return (
          <button
            key={e.symbol}
            onClick={() => onSelect(e.symbol)}
            className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors ${isSelected ? "bg-[var(--color-surface-soft)]" : "bg-transparent"}`}
          >
            <span className="text-xs font-black text-[var(--color-muted)] w-5 shrink-0">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold">{DISPLAY_NAME[e.symbol] ?? e.symbol}</p>
                <span className={`text-[9px] font-bold text-white px-2 py-0.5 rounded-full ${tag.color}`}>{tag.label}</span>
              </div>
              <p className="text-[10px] text-[var(--color-muted)] truncate mt-0.5">{statusText}</p>
            </div>
            <p className="text-xl font-black tabular-nums shrink-0">{e.loading || e.unavailable ? "—" : e.result?.overallScore ?? "—"}</p>
          </button>
        );
      })}
    </div>
  );
}
