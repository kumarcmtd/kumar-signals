import { useEffect, useMemo, useRef } from "react";
import { useCandles } from "../api/hooks";
import { useTimeframeSuite, TIMEFRAMES } from "./useTimeframeSuite";
import { scanAllSetups, type TimedScanResult } from "../utils/kimiScanner";
import { findPlaybookSetup, calculateHitProbability } from "../utils/kimiPlaybook";
import { findEliteSignal } from "../utils/eliteSignal";
import { decisionLabelWithScore } from "../utils/timeframeEngine";
import { useAppStore, type AlertEntry } from "../store/appStore";
import { fireBrowserNotification, playAlertSound } from "../utils/notify";

type TradableSymbol = "CRUDEOIL" | "NATURALGAS";
const DISPLAY_NAME: Record<TradableSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

function useKimiScan(symbol: TradableSymbol, commodity: "NG" | "CL"): TimedScanResult[] {
  const c15 = useCandles(symbol, "15");
  const c30 = useCandles(symbol, "30");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  const tfQueries = [c15, c30, c60, c240];
  return useMemo(() => {
    const timeframes = TIMEFRAMES.map(({ tf, label }, i) => ({ tf, label, candles: tfQueries[i].data?.candles ?? [] }));
    return scanAllSetups(commodity, timeframes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, c15.data, c30.data, c60.data, c240.data]);
}

// Mounted once at the app-shell level so alerts keep firing no matter which
// page is open. Every source here reuses the exact same scoring/scanning
// functions the pages themselves already display -- this never invents a
// signal a page wouldn't also be showing, it just watches in the background.
//
// Dedup strategy: for the Timeframe/Elite engines (decision-based), an alert
// only fires when the decision for a given symbol+timeframe key CHANGES --
// so a STRONG BUY that persists across many 15s polls fires once, not every
// poll, but firing again after it lapses back to WAIT and returns is a new
// occurrence. For Kimi (pattern-based), a setup fires when it newly appears
// in the live-suggestions list for that symbol+setup+timeframe key (tracked
// as a plain "present last poll" set) -- once it drops off the list and
// later reappears, that's treated as a new occurrence too.
export function useAlertEngine(): void {
  const alertSettings = useAppStore((s) => s.alertSettings);
  const addAlerts = useAppStore((s) => s.addAlerts);

  const crudeOil = useTimeframeSuite("CRUDEOIL", null);
  const naturalGas = useTimeframeSuite("NATURALGAS", null);
  const ngKimi = useKimiScan("NATURALGAS", "NG");
  const clKimi = useKimiScan("CRUDEOIL", "CL");

  const lastSignatureRef = useRef<Map<string, string>>(new Map());
  const kimiPresentRef = useRef<Set<string>>(new Set());
  const firstRunRef = useRef(true);

  useEffect(() => {
    if (!alertSettings.enabled) return;
    const now = Date.now();
    const fresh: AlertEntry[] = [];

    if (alertSettings.sources.timeframe) {
      const suites: [TradableSymbol, typeof crudeOil][] = [
        ["CRUDEOIL", crudeOil],
        ["NATURALGAS", naturalGas],
      ];
      for (const [symbol, suite] of suites) {
        for (const a of suite.analyses) {
          if (a.insufficient || a.decision === "WAIT") continue;
          const isStrong = a.decision === "STRONG BUY" || a.decision === "STRONG SELL";
          if (alertSettings.minTier === "strong" && !isStrong) continue;
          const key = `tf-${symbol}-${a.tf}`;
          if (lastSignatureRef.current.get(key) === a.decision) continue;
          lastSignatureRef.current.set(key, a.decision);
          if (firstRunRef.current) continue;
          fresh.push({
            id: `${key}-${now}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: now,
            source: "Timeframe",
            symbol,
            tfLabel: a.label,
            title: `${decisionLabelWithScore(a.decision)} — ${DISPLAY_NAME[symbol]} (${a.label})`,
            detail: a.reasons.slice(0, 2).join("; ") || "Confluence signal fired",
            read: false,
          });
        }
      }
    }

    if (alertSettings.sources.elite) {
      const buildEntries = (symbol: TradableSymbol, suite: typeof crudeOil) =>
        suite.analyses.map((a) => ({ symbol, analysis: a, options: suite.options }));
      const eliteBySymbol: [TradableSymbol, ReturnType<typeof findEliteSignal>][] = [
        ["CRUDEOIL", findEliteSignal(buildEntries("CRUDEOIL", crudeOil))],
        ["NATURALGAS", findEliteSignal(buildEntries("NATURALGAS", naturalGas))],
      ];
      for (const [symbol, elite] of eliteBySymbol) {
        if (!elite) continue;
        const key = `elite-${symbol}`;
        const sig = `${elite.analysis.tf}-${elite.analysis.decision}`;
        if (lastSignatureRef.current.get(key) === sig) continue;
        lastSignatureRef.current.set(key, sig);
        if (firstRunRef.current) continue;
        fresh.push({
          id: `${key}-${now}-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: now,
          source: "Elite",
          symbol,
          tfLabel: elite.analysis.label,
          title: `AI Elite ${decisionLabelWithScore(elite.analysis.decision)} — ${DISPLAY_NAME[symbol]} (${elite.analysis.label})`,
          detail: `Confirmed by ${elite.confirmingTimeframes.join(", ") || "no other timeframes"}`,
          read: false,
        });
      }
    }

    if (alertSettings.sources.kimi) {
      const kimiLists: [TradableSymbol, "NG" | "CL", TimedScanResult[]][] = [
        ["NATURALGAS", "NG", ngKimi],
        ["CRUDEOIL", "CL", clKimi],
      ];
      const presentNow = new Set<string>();
      for (const [symbol, commodity, results] of kimiLists) {
        for (const r of results) {
          const key = `kimi-${symbol}-${r.setupName}-${r.tf}`;
          presentNow.add(key);
          if (kimiPresentRef.current.has(key) || firstRunRef.current) continue;
          const matchedSetup = findPlaybookSetup(r.setupName, commodity);
          const probResult = calculateHitProbability(r.setupName, commodity, matchedSetup?.requiredConfluence ?? []);
          const prob = "error" in probResult ? null : probResult;
          if (prob?.blocked) continue;
          const isTradeable = prob?.recommendation === "STRONG BUY" || prob?.recommendation === "BUY";
          if (alertSettings.minTier === "strong" && !isTradeable) continue;
          fresh.push({
            id: `${key}-${now}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: now,
            source: "Kimi",
            symbol,
            tfLabel: r.tfLabel,
            title: `${r.setupName} — ${DISPLAY_NAME[symbol]} (${r.tfLabel})`,
            detail: prob ? `${prob.recommendation} · ${prob.finalProbability}% hit probability` : (r.notes[0] ?? "Setup triggered"),
            read: false,
          });
        }
      }
      kimiPresentRef.current = presentNow;
    }

    firstRunRef.current = false;
    if (!fresh.length) return;

    addAlerts(fresh);
    if (alertSettings.browserNotifications) {
      for (const a of fresh) fireBrowserNotification(a.title, a.detail);
    }
    if (alertSettings.soundEnabled) playAlertSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    alertSettings.enabled,
    alertSettings.minTier,
    alertSettings.sources.timeframe,
    alertSettings.sources.elite,
    alertSettings.sources.kimi,
    alertSettings.browserNotifications,
    alertSettings.soundEnabled,
    crudeOil.analyses,
    naturalGas.analyses,
    ngKimi,
    clKimi,
  ]);
}
