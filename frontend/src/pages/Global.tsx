import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useGlobalMarkets, useMarketStatus } from "../api/hooks";
import type { GlobalQuote } from "../types";

function fmt(n: number | null, digits = 2) {
  if (n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

const MCX_LABEL: Record<string, string> = {
  CRUDEOIL: "MCX Crude Oil",
  NATURALGAS: "MCX Natural Gas",
};

export function Global() {
  const { data: market } = useMarketStatus();
  const { data: quotes, isLoading, error } = useGlobalMarkets();

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-sm font-bold mb-1">Overseas Markets</p>
        <p className="text-xs text-[var(--color-muted)] leading-relaxed">
          MCX Crude Oil tracks WTI/Brent, and MCX Natural Gas tracks Henry Hub. Both keep trading on NYMEX/ICE well
          past MCX's ~23:30 IST close, so this shows which way things are drifting overnight.
          {market && !market.isOpen && " MCX is currently closed."}
        </p>
      </div>

      {isLoading && <div className="card p-4 text-sm text-[var(--color-muted)]">Loading overseas quotes…</div>}
      {error && <div className="card p-4 text-sm text-[var(--color-sell)]">{(error as Error).message}</div>}

      <div className="space-y-3">
        {quotes?.map((q) => (
          <GlobalQuoteCard key={q.symbol} quote={q} />
        ))}
      </div>

      <p className="text-[11px] text-[var(--color-muted)] px-1">
        Quotes are from Yahoo Finance's public data feed for the continuous futures contract, not MCX's own
        settlement formula — treat this as a directional read (up/down), not an exact MCX price prediction.
        Educational reference only, not financial advice.
      </p>
    </div>
  );
}

function GlobalQuoteCard({ quote }: { quote: GlobalQuote }) {
  if (quote.error || quote.price === null) {
    return (
      <div className="card p-4 text-sm">
        <p className="font-bold">{quote.name}</p>
        <p className="text-[var(--color-sell)] mt-1">{quote.error ?? "No data available"}</p>
      </div>
    );
  }

  const up = (quote.change ?? 0) >= 0;
  const color = up ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]";
  const bg = up ? "bg-[var(--color-buy-soft)]" : "bg-[var(--color-sell-soft)]";

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">{quote.name}</p>
          <p className="text-[11px] text-[var(--color-muted)]">Tracks {MCX_LABEL[quote.tracksMCX] ?? quote.tracksMCX}</p>
        </div>
        {quote.marketState && (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-[var(--color-surface-soft)] text-[var(--color-muted)]">
            {quote.marketState}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between">
        <p className="text-2xl font-bold">
          {quote.currency === "USD" ? "$" : quote.currency ? `${quote.currency} ` : ""}
          {fmt(quote.price)}
        </p>
        <div className={`flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold text-sm ${bg} ${color}`}>
          {up ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          {fmt(quote.change)} ({fmt(quote.changePercent)}%)
        </div>
      </div>
      {quote.asOf && <p className="text-[11px] text-[var(--color-muted)]">As of {new Date(quote.asOf).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</p>}
    </div>
  );
}
