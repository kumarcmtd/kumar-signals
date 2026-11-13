// Re-tests the Ai20-20 rules on ~15 days of 5-minute candles OFF the main
// thread. Scoring every candle runs the page's whole indicator read ~2,400
// times -- 1-2 seconds on a phone -- which froze the page while it ran.

import { measureV2 } from "../utils/twentyV2";
import type { Candle } from "../types";
import type { LabSym } from "../utils/twentyLab";

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; sym: LabSym; candles: Candle[] }>) => void) | null; postMessage: (m: unknown) => void };

ctx.onmessage = (e) => {
  const { id, sym, candles } = e.data;
  let record = null;
  try {
    const r = measureV2(candles, sym);
    record = r ? { ...r, trades: [] } : null;
  } catch {
    record = null;
  }
  ctx.postMessage({ id, record });
};
