import { useEffect } from "react";
import { useAppStore, type SignalSnapshot } from "../store/appStore";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";

interface ProjLike {
  strike: number;
  entry: number;
  targets: [number, number, number];
  stop: number;
}

// A snapshot older than this is treated as stale rather than resumed --
// covers a full MCX session (up to ~23:30 IST) without carrying a forgotten
// signal from a previous day's session into today's numbers.
const SNAPSHOT_TTL_MS = 16 * 60 * 60 * 1000;

export type TradeStatus = "SL Hit" | "Target 1 Hit" | "Target 2 Hit" | "Target 3 Hit" | "Running" | null;

export function computeTradeStatus(snapshot: SignalSnapshot | undefined, liveLtp: number | null): TradeStatus {
  if (!snapshot || liveLtp === null) return null;
  if (liveLtp <= snapshot.stop) return "SL Hit";
  if (liveLtp >= snapshot.targets[2]) return "Target 3 Hit";
  if (liveLtp >= snapshot.targets[1]) return "Target 2 Hit";
  if (liveLtp >= snapshot.targets[0]) return "Target 1 Hit";
  return "Running";
}

// Freezes each timeframe's trade recommendation the moment it first becomes
// actionable, so later renders can compare the CURRENT live premium against
// the ORIGINAL entry/target/stop instead of re-deriving all three from
// today's live price every single render (which would make "target hit"
// structurally impossible to ever observe).
export function useSignalTracking(symbol: string, analyses: TimeframeAnalysis[], projections: (ProjLike | null)[]) {
  const signalSnapshots = useAppStore((s) => s.signalSnapshots);
  const setSignalSnapshot = useAppStore((s) => s.setSignalSnapshot);
  const clearSignalSnapshot = useAppStore((s) => s.clearSignalSnapshot);

  useEffect(() => {
    analyses.forEach((a, i) => {
      const key = `${symbol}-${a.tf}`;
      const proj = projections[i];
      const existing = signalSnapshots[key];

      if (a.decision === "WAIT" || a.insufficient || !proj || !a.optSide) {
        if (existing) clearSignalSnapshot(key);
        return;
      }

      const stale = existing && Date.now() - existing.capturedAt > SNAPSHOT_TTL_MS;
      const identityChanged = !existing || stale || existing.strike !== proj.strike || existing.optSide !== a.optSide;
      if (identityChanged) {
        setSignalSnapshot(key, {
          strike: proj.strike,
          optSide: a.optSide,
          entry: proj.entry,
          targets: proj.targets,
          stop: proj.stop,
          capturedAt: Date.now(),
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, analyses, projections]);

  return signalSnapshots;
}
