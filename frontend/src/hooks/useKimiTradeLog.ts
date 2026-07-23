import { useCallback, useEffect, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import { liveLtpFor, openNewEntry, advanceOpenEntry } from "./useTradeLog";
import type { TimedScanResult } from "../utils/kimiScanner";
import type { OptionsAnalytics } from "../types";

const MAX_HISTORY = 10;

interface ScanPremium {
  strike: number;
  optSide: "CE" | "PE";
  entry: number;
  target: number;
  stop: number;
}

// Tracks the Kimi playbook scanner's own live suggestions the same way
// AI-Test V2 tracks its timeframe signals -- one open line per (symbol,
// setup, timeframe), stored under a distinct "KIMI-<symbol>-..." key in the
// SAME shared tradeLogs dictionary so it never collides with AI-Test/Elite's
// own keys. Each setup only ever has a single target (unlike the tiered
// 3-target model elsewhere), so all three target slots are set equal --
// touching it closes the trade outright as a win, with no partial-exit
// trailing states in between. A setup dropping out of the live scan doesn't
// stop its already-open trade from being tracked to target/stop.
export function useKimiTradeLog(
  symbol: string,
  liveSuggestions: TimedScanResult[],
  projectPremium: (r: TimedScanResult) => ScanPremium | null,
  options: OptionsAnalytics | undefined
) {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const setTradeLog = useAppStore((s) => s.setTradeLog);
  const prefix = `KIMI-${symbol}-`;

  useEffect(() => {
    const now = Date.now();

    Object.keys(tradeLogs).forEach((key) => {
      if (!key.startsWith(prefix)) return;
      const history = tradeLogs[key];
      const last = history[history.length - 1];
      if (!last || last.closed) return;
      const liveLtp = liveLtpFor(options, last.strike, last.optSide);
      const advanced = advanceOpenEntry(last, liveLtp, now);
      if (advanced !== last) setTradeLog(key, [...history.slice(0, -1), advanced]);
    });

    liveSuggestions.forEach((r) => {
      const key = `${prefix}${r.setupName}-${r.tf}`;
      const history = tradeLogs[key] ?? [];
      const last = history[history.length - 1];
      if (last && !last.closed) return;
      const premium = projectPremium(r);
      if (!premium) return;
      const created = openNewEntry(
        { strike: premium.strike, optSide: premium.optSide, entry: premium.entry, targets: [premium.target, premium.target, premium.target], stop: premium.stop },
        now
      );
      const next = [...history, created];
      setTradeLog(key, next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, liveSuggestions, options]);

  const stats = useMemo(() => {
    const entries = Object.keys(tradeLogs)
      .filter((k) => k.startsWith(prefix))
      .flatMap((k) => tradeLogs[k]);
    const targetHit = entries.filter((e) => e.status === "target3_hit").length;
    const slHit = entries.filter((e) => e.status === "sl_hit").length;
    const running = entries.filter((e) => !e.closed).length;
    const closed = targetHit + slHit;
    const winRatePct = closed > 0 ? Math.round((targetHit / closed) * 100) : null;
    return { entries, targetHit, slHit, running, closed, winRatePct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeLogs, symbol]);

  // The time the CURRENT (most recent) line for this exact setup+timeframe
  // was first opened -- i.e. when this call was given, not when it last ticked.
  const openedAtFor = useCallback(
    (setupName: string, tf: string) => {
      const history = tradeLogs[`${prefix}${setupName}-${tf}`];
      const last = history?.[history.length - 1];
      return last?.openedAt ?? null;
    },
    [tradeLogs, prefix]
  );

  return { ...stats, openedAtFor };
}
