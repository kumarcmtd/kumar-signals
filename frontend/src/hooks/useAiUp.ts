import { useMemo } from "react";
import { useCandles, useOptionsAnalytics } from "../api/hooks";
import { detectReversal } from "../utils/reversalCatchEngine";
import { projectPremiumFromUnderlying } from "../utils/optionProjection";
import { computePriceSpeed } from "../utils/priceSpeed";
import { useEliteTradeLog } from "./useTradeLog";
import type { Decision6 } from "../utils/timeframeEngine";

export type AiUpSymbol = "CRUDEOIL" | "NATURALGAS";
const TRACKING_KEY: Record<AiUpSymbol, string> = { CRUDEOIL: "AIUP-CRUDEOIL", NATURALGAS: "AIUP-NATURALGAS" };

// Ties the pure reversal-catch engine to live 15m candles + the option chain,
// and tracks whatever it fires under its own AIUP-<symbol> line so the
// server-side Cron advances/closes it exactly like every other engine's calls.
export function useAiUp(symbol: AiUpSymbol) {
  const c15 = useCandles(symbol, "15");
  const { data: options } = useOptionsAnalytics(symbol);
  const liveOptions = options && !options.error ? options : undefined;

  const candles = useMemo(() => c15.data?.candles ?? [], [c15.data]);
  const scan = useMemo(() => detectReversal(candles), [candles]);

  const atmDelta = liveOptions?.atmStrike != null ? liveOptions.rows.find((r) => r.strike === liveOptions.atmStrike)?.call.delta ?? null : null;
  const speed = useMemo(() => (candles.length ? computePriceSpeed(candles, atmDelta) : null), [candles, atmDelta]);

  const decision: Decision6 = scan.setup ? (scan.setup.confidence >= 70 ? (scan.setup.direction === "bullish" ? "STRONG BUY" : "STRONG SELL") : scan.setup.direction === "bullish" ? "BUY" : "SELL") : "WAIT";
  const optSide = scan.setup?.optSide ?? null;

  const proj = useMemo(() => {
    if (!scan.setup) return null;
    const p = projectPremiumFromUnderlying(scan.setup.optSide, scan.setup.entry, scan.setup.stop, scan.setup.targets, liveOptions);
    return p ? { strike: p.strike, optSide: scan.setup.optSide, entry: p.entry, targets: p.targets, stop: p.stop } : null;
  }, [scan.setup, liveOptions]);

  const meta = useMemo(
    () => ({
      label: scan.setup ? `AI-Up · ${scan.setup.direction === "bullish" ? "Bounce after fall" : "Fade after rally"}` : "AI-Up",
      reasons: scan.setup?.reasons.filter((r) => r.ok).map((r) => r.text) ?? [],
      confirmingTimeframes: [],
    }),
    [scan.setup]
  );

  const tradeLog = useEliteTradeLog(TRACKING_KEY[symbol], decision, optSide, proj, liveOptions, meta);

  return {
    scan,
    setup: scan.setup,
    decision,
    speed,
    candles,
    options: liveOptions,
    tradeLog,
    trackingKey: TRACKING_KEY[symbol],
    liveDataUnavailable: !!options?.error,
  };
}
