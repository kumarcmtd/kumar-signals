// Runs measureV2 in a Web Worker (see workers/twentyRecord.worker.ts) so the
// page never freezes, and keeps the answer on the phone: the same candles are
// never re-tested twice (a revisit or bringing the app back to the front used
// to redo it). Falls back to the main thread where workers are unavailable.

import type { Candle } from "../types";
import { rulesLabel, type LabSym } from "./twentyLab";
import { measureV2, V2_RULES, type V2Record } from "./twentyV2";

const CACHE = (sym: LabSym) => `twenty.record.${rulesLabel(V2_RULES)}.${sym}`;
let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: V2Record | null) => void; sym: LabSym; candles: Candle[] }>();

function onMain(candles: Candle[], sym: LabSym): Promise<V2Record | null> {
  return new Promise((resolve) =>
    setTimeout(() => {
      const r = measureV2(candles, sym);
      resolve(r ? { ...r, trades: [] } : null);
    }, 60)
  );
}

function getWorker(): Worker | null {
  if (worker || workerBroken || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("../workers/twentyRecord.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; record: V2Record | null }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      job?.resolve(e.data.record);
    };
    worker.onerror = () => {
      // A worker that cannot load: finish what was asked on the main thread, and stop using it.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [id, job] of pending) {
        pending.delete(id);
        onMain(job.candles, job.sym).then(job.resolve);
      }
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

export function measureV2Async(candles: Candle[], sym: LabSym): Promise<V2Record | null> {
  const last = candles[candles.length - 1]?.date ?? "";
  const stamp = `${candles.length}|${last}`;
  try {
    const hit = JSON.parse(localStorage.getItem(CACHE(sym)) ?? "null");
    if (hit && hit.stamp === stamp) return Promise.resolve(hit.record as V2Record | null);
  } catch {
    /* no storage */
  }
  const save = (r: V2Record | null) => {
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
