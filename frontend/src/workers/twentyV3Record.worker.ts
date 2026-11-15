// Re-tests the live Ai20-20 v3 setups on ~20 days of real MCX 5-minute
// candles OFF the main thread, so the page never freezes while it runs.

import { measureV3 } from "../utils/twentyV3/live";
import { engineById, type EngineId } from "../utils/twentyV3/engines";
import type { Candle } from "../types";
import type { LabSym } from "../utils/twentyLab";

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; sym: LabSym; candles: Candle[]; engine?: EngineId }>) => void) | null; postMessage: (m: unknown) => void };

ctx.onmessage = (e) => {
  const { id, sym, candles, engine } = e.data;
  let record = null;
  try {
    const r = measureV3(candles, sym, engineById(engine ?? "v3"));
    record = r ? { ...r, trades: r.trades.slice(-60) } : null;
  } catch {
    record = null;
  }
  ctx.postMessage({ id, record });
};
