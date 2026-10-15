import { useEffect, useMemo, useState } from "react";
import { useCandles, useMarketStatus, useNewsTrade, useOptionsAnalytics } from "../api/hooks";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { evaluateBuyDecision, type DecisionResult, type Plan } from "../utils/buyDecisionEngine";
import { mcxSessionAt } from "../utils/mcxSession";
import { scheduledEvents } from "../utils/timeProfileEngine";
import { daysToExpiry } from "../utils/oiBuildup";
import { liveMomentum } from "../utils/liveMomentum";
import { trendPulse } from "../utils/trendPulse";
import { newsPulseFor } from "../utils/newsPulse";
import { callMatch } from "../utils/callMatch";
import type { InstrumentSymbol, OptionsAnalytics } from "../types";

export interface OptionPick {
  strike: number;
  side: "CE" | "PE";
  ltp: number | null;
  delta: number | null;
  expiry: string;
  /** Premium if the underlying reaches each plan level -- delta estimate. */
  atStop: number | null;
  atT1: number | null;
  atT2: number | null;
}

export interface EntryCheck {
  tone: "ok" | "warn" | "bad";
  text: string;
}

const WEEK_MIN = 7 * 24 * 60;

function optionPick(options: OptionsAnalytics | undefined, plan: Plan | null): OptionPick | null {
  if (!options || options.error || options.atmStrike === null || !plan) return null;
  const row = options.rows.find((r) => r.strike === options.atmStrike);
  if (!row) return null;
  const leg = plan.side === "CE" ? row.call : row.put;
  const delta = typeof leg.delta === "number" && Number.isFinite(leg.delta) ? leg.delta : null;
  const at = (level: number) => (leg.ltp !== null && delta !== null ? Math.max(0.05, Math.round((leg.ltp + delta * (level - options.spot)) * 100) / 100) : null);
  return { strike: row.strike, side: plan.side, ltp: leg.ltp, delta, expiry: options.expiry, atStop: at(plan.stop), atT1: at(plan.t1), atT2: at(plan.t2) };
}

/** Live price vs the plan. Shown beside the verdict; never changes it. */
function entryCheck(r: DecisionResult | null, live: number | null): EntryCheck | null {
  if (!r || !r.plan || live === null || !r.verdict.startsWith("BUY")) return null;
  const { plan } = r;
  const up = plan.side === "CE";
  const moved = up ? live - plan.entry : plan.entry - live;
  const broken = up ? live <= plan.stop : live >= plan.stop;
  if (broken) return { tone: "bad", text: `Price (₹${live.toFixed(2)}) is already past the stop since the candle closed — don't enter now. The next close updates this.` };
  if (moved > plan.riskPts) return { tone: "warn", text: `Price has run ₹${moved.toFixed(2)} beyond the entry — late. Better entry on a pullback toward ₹${plan.entry.toFixed(2)}.` };
  if (moved < -plan.riskPts * 0.5) return { tone: "warn", text: `Price has pulled back ₹${(-moved).toFixed(2)} from the entry — still above the stop, but let the next candle close confirm.` };
  return { tone: "ok", text: `Price ₹${live.toFixed(2)} is close to the entry zone.` };
}

export function useBuyDecision(symbol: InstrumentSymbol) {
  const c15 = useCandles(symbol, "15");
  const c60 = useCandles(symbol, "60");
  const c240 = useCandles(symbol, "240");
  // 5-minute candles for the "right now" read between 15-minute closes.
  const c5 = useCandles(symbol, "5");
  const optionsQ = useOptionsAnalytics(symbol);
  const { data: market } = useMarketStatus();

  // A minute clock, so the candle that is still forming drops out at the
  // right moment even between data refreshes.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 15_000);
    return () => clearInterval(id);
  }, []);

  const session = mcxSessionAt(minute * 60_000);
  // The live market-status call knows holidays; the clock is the fallback.
  const marketOpen = market ? market.isOpen : session.isOpen;
  const options = optionsQ.data && !optionsQ.data.error ? optionsQ.data : undefined;
  const optionDays = options ? daysToExpiry(options.expiry, minute * 60_000) : null;

  const result = useMemo(() => {
    const a = c15.data?.candles;
    if (!a) return null;
    const now = minute * 60_000;
    const event = scheduledEvents(now).find((e) => e.affects === symbol);
    const eia = event ? { minutesAway: event.minutesAway, minutesSince: WEEK_MIN - event.minutesAway, label: event.name } : null;
    return evaluateBuyDecision({
      c15: a,
      c60: c60.data?.candles ?? [],
      c240: c240.data?.candles ?? [],
      now,
      marketOpen,
      eia,
      minutesToClose: session.isOpen ? session.closeMin - session.minutes : null,
      daysToOptionExpiry: optionDays,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c15.data, c60.data, c240.data, minute, marketOpen, symbol, optionDays]);

  const candles = c15.data?.candles;
  const livePrice = candles?.length ? candles[candles.length - 1].close : null;
  const pick = useMemo(() => optionPick(options, result?.plan ?? null), [options, result?.plan]);
  const rawEntry = useMemo(() => entryCheck(result, livePrice), [result, livePrice]);
  // What price has done since the last closed candle -- never changes the verdict.
  const live = useMemo(
    () => (candles ? liveMomentum(candles, c5.data?.candles ?? [], result, Date.now(), marketOpen) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candles, c5.data, result, minute, marketOpen],
  );
  // Steady vs choppy 5-minute candles, and whether price has already run far.
  const pulse = useMemo(
    () => (c5.data?.candles?.length ? trendPulse(c5.data.candles, Date.now(), livePrice) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c5.data, livePrice, minute],
  );
  // The news (risk premium) side, from the shared news feed the News page uses.
  const newsQ = useNewsTrade();
  const news = useMemo(() => {
    const d = newsQ.data;
    if (!d?.news?.available) return null;
    const eia = symbol === "CRUDEOIL" ? (d.eia?.crude ?? null) : symbol === "NATURALGAS" ? (d.eia?.ngStorage ?? null) : null;
    return newsPulseFor(symbol === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL", d.news.articles ?? [], eia, d.news.builtAt ?? d.fetchedAt ?? null, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newsQ.data, symbol, minute]);

  // "Close to the entry zone" must not sit next to a live REVERSING / stop-broken read.
  // On a BUY, one entry answer that also weighs the 5-minute candles, a late
  // (stretched) entry and the news -- the same rule as the MATCHED alert.
  const entryGate = useMemo(
    () => (result?.side && (result.verdict === "BUY_CE" || result.verdict === "BUY_PE") ? callMatch(result, live, result.side, { pulse, news }) : null),
    [result, live, pulse, news],
  );
  const entry: EntryCheck | null =
    rawEntry?.tone === "ok" && live?.tone === "bad"
      ? null
      : rawEntry?.tone === "ok" && entryGate && !entryGate.ok
        ? { tone: "warn", text: entryGate.text.replace(/^Both agree, but /, "Don't enter yet: ") }
        : rawEntry?.tone === "ok" && entryGate?.ok
          ? { tone: "ok", text: `${rawEntry.text} Steady 5-min candles, not stretched, news not against — clean entry.` }
          : rawEntry;

  // A Best Call trade already running on this symbol, so the page can say
  // whether this read agrees with it.
  const bestLog = useAppStore((s) => s.tradeLogs[`BEST-${symbol}`]);
  const running: TradeLogEntry | null = bestLog?.length && !bestLog[bestLog.length - 1].closed ? bestLog[bestLog.length - 1] : null;

  // The Worker answers 200 with { error } when Upstox fails (login expired,
  // no contract, too few bars), so that counts as an error too -- it used to
  // vanish and read as "not enough finished candles".
  const bodyError = (d: unknown) => (d && typeof d === "object" && "error" in d ? String((d as { error: unknown }).error) : null);
  const error = (c15.error as Error | null)?.message ?? bodyError(c15.data) ?? bodyError(c60.data) ?? bodyError(c240.data) ?? null;
  const loading = c15.isLoading || c60.isLoading || c240.isLoading;
  const updatedAt = Math.max(c15.dataUpdatedAt, c5.dataUpdatedAt, c60.dataUpdatedAt, c240.dataUpdatedAt);
  const refetch = () => Promise.all([c15.refetch(), c5.refetch(), c60.refetch(), c240.refetch(), optionsQ.refetch()]);

  return { result, pick, entry, entryGate, live, pulse, news, livePrice, running, marketOpen, optionDays, loading, error, updatedAt, refetch };
}
