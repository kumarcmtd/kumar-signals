// AI Pullback -- the full read behind the compact card on the main tabs.
//
// A NEW page. It adds a route and one nav entry and changes nothing that
// already works. Every number on it comes from the ONE central engine
// (utils/pullbackReversalEngine.ts) via a single shared query, so this page and
// the card on AI-Shoot can never disagree.
//
// The question it exists to answer: price is falling -- is this a pullback
// inside a bullish trend, or has the trend actually turned? UNCERTAIN is a
// legitimate answer here, and the page says so rather than forcing a direction.

import { useState } from "react";
import { Activity, RefreshCw, Layers, Gauge, Newspaper, AlarmClock } from "lucide-react";
import { usePullback, useMarketStatus } from "../api/hooks";
import {
  PullbackStatusCard, StateBanner, StructureTable, ZoneRow, WhyPanel, LevelsPanel, SectionLabel,
} from "../components/PullbackKit";
import type { InstrumentSymbol } from "../types";

const SYMBOLS: { key: InstrumentSymbol; label: string }[] = [
  { key: "CRUDEOIL", label: "Crude Oil" },
  { key: "NATURALGAS", label: "Natural Gas" },
];

export function AiPullback() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("NATURALGAS");
  const { data, isLoading, isFetching, error, refetch } = usePullback(symbol);
  const status = useMarketStatus();

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center gap-2">
        <Activity size={20} className="text-indigo-600" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-black leading-none text-slate-900">AI Pullback</h1>
          <p className="text-[9.5px] text-slate-500 mt-0.5">Is this a pullback, or has the trend turned?</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-[var(--color-surface-soft)] text-[var(--color-muted)] shrink-0"
        >
          <RefreshCw size={11} className={isFetching ? "motion-safe:animate-spin" : ""} />
          Update
        </button>
      </header>

      <div className="flex gap-2">
        {SYMBOLS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSymbol(key)}
            className="flex-1 py-2 rounded-xl text-[11.5px] font-black transition-colors"
            style={symbol === key ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && <div className="h-40 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />}

      {error && !data && (
        <div className="rounded-2xl px-3 py-2.5 bg-red-50 border border-red-200">
          <p className="text-[11.5px] font-black text-red-700">Couldn't load the reading</p>
          <p className="text-[10px] text-red-700/80 mt-0.5">{(error as Error).message}</p>
        </div>
      )}

      {data && (
        <>
          <StateBanner result={data} />

          <section>
            <SectionLabel note="The move itself, graded — a red candle on its own is not a fall.">Current fall</SectionLabel>
            <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5">
              <p className="text-[13px] font-black text-slate-800">{data.fall.label}</p>
              <p className="text-[10.5px] text-slate-600 leading-snug mt-0.5">{data.fall.detail}</p>
              {!status.data?.isOpen && (
                <p className="text-[9.5px] text-slate-400 mt-1.5">MCX is closed — this is the last completed reading, not a live one.</p>
              )}
            </div>
          </section>

          <section>
            <SectionLabel note="The slow timeframes decide the structure; the fast ones only time it.">
              <span className="inline-flex items-center gap-1.5"><Layers size={13} className="text-slate-400" /> Timeframe structure</span>
            </SectionLabel>
            <StructureTable structures={data.structures} />
          </section>

          <section>
            <SectionLabel note="Zones, not exact numbers. A level backed by several things is stronger than one backed by one.">
              <span className="inline-flex items-center gap-1.5"><Gauge size={13} className="text-slate-400" /> Support &amp; resistance</span>
            </SectionLabel>
            <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
              {data.resistanceZones.length === 0 && data.supportZones.length === 0 && (
                <p className="px-3 py-3 text-[10.5px] text-slate-400">No zones could be built — not enough candle history.</p>
              )}
              {data.resistanceZones.slice(0, 3).reverse().map((z, i) => <ZoneRow key={`r${i}`} zone={z} price={data.currentPrice} />)}
              {data.currentPrice !== null && (
                <div className="px-3 py-1.5 bg-indigo-50 border-y border-indigo-100">
                  <p className="text-[11px] font-black text-indigo-700 tabular-nums">Price now · {data.currentPrice.toFixed(2)}</p>
                </div>
              )}
              {data.supportZones.slice(0, 3).map((z, i) => <ZoneRow key={`s${i}`} zone={z} price={data.currentPrice} />)}
            </div>
          </section>

          <section>
            <SectionLabel>Levels that matter</SectionLabel>
            <LevelsPanel result={data} />
          </section>

          <section>
            <WhyPanel result={data} />
          </section>

          <section>
            <SectionLabel note="What the engine could and could not see when it formed this view.">
              <span className="inline-flex items-center gap-1.5"><Newspaper size={13} className="text-slate-400" /> Data behind the call</span>
            </SectionLabel>
            <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5 space-y-1">
              <Row k="Data quality" v={`${data.dataQuality} / 10`} />
              <Row k="Newest news used" v={data.dataAgeMinutes === null ? "No news used" : `${data.dataAgeMinutes} min old`} />
              <Row k="Chart vs news" v={data.conflictDetected ? "They disagree — that is why this is uncertain" : "No conflict"} />
              <Row k="Major fundamental shock" v={data.majorFundamentalShock ? "Yes — treat technicals with caution" : "None detected"} />
              <Row k="Weather" v="No weather source is connected, so it was left out" />
              {data.heldByCooldown && <Row k="Whipsaw protection" v="Holding the previous state — the change was neither big nor lasting enough" />}
            </div>
          </section>

          <p className="text-[9.5px] text-slate-400 leading-relaxed px-1">
            <AlarmClock size={10} className="inline mr-1" />
            Educational reference only, not financial advice. "Model confidence" describes how strongly this engine's own rules agree — it is not a probability of profit and never exceeds 94%.
            Anything unavailable is reported as unavailable rather than filled in. Confirmation always means a candle CLOSE beyond a level, never a wick through it.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] text-slate-400 shrink-0">{k}</span>
      <span className="text-[10.5px] font-bold text-slate-700 text-right">{v}</span>
    </div>
  );
}

/**
 * The compact card for the main tabs. Kept here so a page only imports one
 * thing, and so the navigation target can never drift from the page itself.
 */
export function PullbackMiniCard({ symbol, onOpen }: { symbol: InstrumentSymbol; onOpen?: () => void }) {
  const { data, isLoading, error } = usePullback(symbol);
  return <PullbackStatusCard result={data} loading={isLoading} error={error ? (error as Error).message : null} onOpen={onOpen} />;
}
