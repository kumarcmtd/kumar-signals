// Runs measureV3 in a Web Worker so the page never freezes, and keeps the
// answer on the phone until new candles arrive. Falls back to the main thread
// where workers are unavailable.

import type { Candle } from "../../types";
import type { LabSym } from "../twentyLab";
import { measureV3, V3_ACTIVE, type V3Record } from "./live";

const CACHE = (sym: LabSym) => `twenty.v3record.${V3_ACTIVE[sym].join("+")}.${sym}`;
let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: V3Record | null) => void; sym: LabSym; candles: Candle[] }>();

const slim = (r: V3Record | null): V3Record | null => (r ? { ...r, trades: r.trades.slice(-60) } : null);

function onMain(candles: Candle[], sym: LabSym): Promise<V3Record | null> {
  return new Promise((resolve) => setTimeout(() => resolve(slim(measureV3(candles, sym))), 60));
}

function getWorker(): Worker | null {
  if (worker || broken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../../workers/twentyV3Record.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; record: V3Record | null }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      job?.resolve(e.data.record);
    };
    worker.onerror = () => {
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) {
        pending.delete(id);
        onMain(job.candles, job.sym).then(job.resolve);
      }
    };
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

export function measureV3Async(candles: Candle[], sym: LabSym): Promise<V3Record | null> {
  const stamp = `${candles.length}|${candles[candles.length - 1]?.date ?? ""}`;
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE(sym)) ?? "null");
    if (hit && hit.stamp === stamp) return Promise.resolve(hit.record as V3Record | null);
  } catch {
    /* no storage */
  }
  const save = (r: V3Record | null) => {
    try {
      localStorage.setItem(CACHE(sym), JSON.stringify({ stamp, record: r }));
    } catch {
      /* private mode or full: just not cached */
    }
    return r;
  };
  const w = getWorker();
  if (!w) return onMain(candles, sym).then(save);
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve: (r) => resolve(save(r)), sym, candles });
    w.postMessage({ id, sym, candles });
  });
}
