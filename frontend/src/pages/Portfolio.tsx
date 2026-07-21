import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { usePortfolio, useCreateTrade, useUpdateTrade, useDeleteTrade } from "../api/hooks";
import { CardSkeleton } from "../components/Skeleton";
import { computePortfolioSummary } from "../utils/portfolioStats";
import type { InstrumentSymbol, OptionSide, PortfolioTrade } from "../types";

const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };

export function Portfolio() {
  const { data: trades, isLoading, error } = usePortfolio();
  const createTrade = useCreateTrade();
  const updateTrade = useUpdateTrade();
  const deleteTrade = useDeleteTrade();
  const [showForm, setShowForm] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");

  const summary = useMemo(() => computePortfolioSummary(trades ?? []), [trades]);
  const openTrades = (trades ?? []).filter((t) => t.status === "OPEN");
  const closedTrades = (trades ?? []).filter((t) => t.status === "CLOSED");

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <p className="text-sm font-bold">Portfolio</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">Your own trade ledger — log entries manually or from a Master AI call, close them out, and track real performance.</p>
      </div>

      {isLoading && <CardSkeleton />}
      {error && <div className="card p-4 text-sm text-[var(--color-sell)]">{(error as Error).message}</div>}

      {trades && (
        <>
          <div className="card p-4 grid grid-cols-2 gap-2">
            <Stat label="Total P&L" value={`₹${summary.totalPnl.toFixed(0)}`} tone={summary.totalPnl >= 0 ? "buy" : "sell"} />
            <Stat label="Open positions" value={String(summary.openCount)} />
            <Stat label="Win rate" value={summary.winRate !== null ? `${summary.winRate.toFixed(0)}%` : "—"} />
            <Stat
              label="Profit factor"
              value={summary.profitFactor === null ? "—" : summary.profitFactor === Infinity ? "∞" : summary.profitFactor.toFixed(2)}
            />
            <Stat label="Avg win" value={summary.avgWin !== null ? `₹${summary.avgWin.toFixed(0)}` : "—"} tone="buy" />
            <Stat label="Avg loss" value={summary.avgLoss !== null ? `₹${summary.avgLoss.toFixed(0)}` : "—"} tone="sell" />
          </div>

          <button
            onClick={() => setShowForm((s) => !s)}
            className="w-full rounded-xl py-2.5 text-sm font-bold bg-gradient-to-r from-orange-500 to-pink-600 text-white"
          >
            {showForm ? "Cancel" : "+ Log a trade"}
          </button>

          {showForm && (
            <TradeForm
              onSubmit={(trade) => {
                createTrade.mutate(trade, { onSuccess: () => setShowForm(false) });
              }}
              submitting={createTrade.isPending}
              error={createTrade.error as Error | null}
            />
          )}

          <section>
            <SectionTitle>Open positions</SectionTitle>
            {openTrades.length === 0 && <p className="text-xs text-[var(--color-muted)] px-1">No open positions.</p>}
            <div className="space-y-2">
              {openTrades.map((t) => (
                <div key={t.id} className="card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">
                      {t.symbol}
                      {t.strike ? ` ${t.strike} ${t.optSide}` : ""}
                    </p>
                    <button onClick={() => deleteTrade.mutate(t.id)} className="text-[var(--color-muted)]">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <MiniStat label="Entry" value={`₹${t.entryPrice}`} />
                    <MiniStat label="SL" value={t.stopLoss !== undefined ? `₹${t.stopLoss}` : "—"} />
                    <MiniStat label="Target" value={t.target !== undefined ? `₹${t.target}` : "—"} />
                    <MiniStat label="Qty" value={`${t.quantity} lot(s)`} />
                  </div>
                  <p className="text-[10px] text-[var(--color-muted)]">
                    Opened {new Date(t.entryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                    {t.source && t.source !== "manual" ? ` · from ${t.source === "master-ai" ? "Master AI" : "Signal"}` : ""}
                  </p>
                  {closingId === t.id ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        placeholder="Exit price"
                        value={exitPrice}
                        onChange={(e) => setExitPrice(e.target.value)}
                        className="flex-1 rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => {
                          const price = Number(exitPrice);
                          if (!price) return;
                          updateTrade.mutate(
                            { id: t.id, patch: { exitPrice: price, status: "CLOSED" } },
                            { onSuccess: () => { setClosingId(null); setExitPrice(""); } }
                          );
                        }}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-buy)] text-white"
                      >
                        Confirm
                      </button>
                      <button onClick={() => setClosingId(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--color-surface-soft)]">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setClosingId(t.id)}
                      className="w-full py-1.5 rounded-lg text-xs font-bold bg-[var(--color-surface-soft)]"
                    >
                      Close position
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle>Closed trades</SectionTitle>
            {closedTrades.length === 0 && <p className="text-xs text-[var(--color-muted)] px-1">No closed trades yet.</p>}
            <div className="space-y-2">
              {closedTrades.map((t) => (
                <div key={t.id} className="card p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">
                      {t.symbol}
                      {t.strike ? ` ${t.strike} ${t.optSide}` : ""}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      ₹{t.entryPrice} → ₹{t.exitPrice} · {t.quantity} lot(s) ·{" "}
                      {t.exitDate ? new Date(t.exitDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-black ${(t.pnl ?? 0) >= 0 ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"}`}>
                      {(t.pnl ?? 0) >= 0 ? "+" : ""}
                      ₹{(t.pnl ?? 0).toFixed(0)}
                    </p>
                    <button onClick={() => deleteTrade.mutate(t.id)} className="text-[var(--color-muted)]">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed px-1">
        Educational reference only. This ledger is stored in the app's backend (Cloudflare KV) so it survives across devices — it does not
        place real orders or read your broker account.
      </p>
    </div>
  );
}

function TradeForm({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (trade: Partial<PortfolioTrade>) => void;
  submitting: boolean;
  error: Error | null;
}) {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const [optSide, setOptSide] = useState<OptionSide>("CE");
  const [strike, setStrike] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [quantity, setQuantity] = useState("1");

  return (
    <div className="card p-4 space-y-3">
      <div className="flex gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-xl py-2 text-xs font-bold ${symbol === sym ? "bg-orange-500 text-white" : "bg-[var(--color-surface-soft)]"}`}
          >
            {sym}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        {(["CE", "PE"] as const).map((side) => (
          <button
            key={side}
            onClick={() => setOptSide(side)}
            className={`flex-1 rounded-xl py-2 text-xs font-bold ${optSide === side ? "bg-slate-700 text-white" : "bg-[var(--color-surface-soft)]"}`}
          >
            {side}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <LabeledInput label="Strike" value={strike} onChange={setStrike} />
        <LabeledInput label="Entry price" value={entryPrice} onChange={setEntryPrice} />
        <LabeledInput label="Stop-loss" value={stopLoss} onChange={setStopLoss} />
        <LabeledInput label="Target" value={target} onChange={setTarget} />
        <LabeledInput label="Quantity (lots)" value={quantity} onChange={setQuantity} />
      </div>
      {error && <p className="text-xs text-[var(--color-sell)]">{error.message}</p>}
      <button
        disabled={submitting}
        onClick={() =>
          onSubmit({
            symbol,
            optSide,
            strike: strike ? Number(strike) : undefined,
            entryPrice: Number(entryPrice),
            stopLoss: stopLoss ? Number(stopLoss) : undefined,
            target: target ? Number(target) : undefined,
            quantity: Number(quantity) || 1,
            lotSize: LOT_SIZE[symbol],
          })
        }
        className="w-full py-2 rounded-xl text-sm font-bold bg-[var(--color-buy)] text-white disabled:opacity-60"
      >
        {submitting ? "Saving…" : "Save trade"}
      </button>
    </div>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs">
      <span className="text-[var(--color-muted)]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm"
      />
    </label>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)] mb-2 px-1">{children}</h2>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "buy" | "sell" }) {
  const color = tone === "buy" ? "text-[var(--color-buy)]" : tone === "sell" ? "text-[var(--color-sell)]" : "";
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-soft)] px-2 py-1.5 text-center">
      <p className="text-[9px] text-[var(--color-muted)]">{label}</p>
      <p className="text-xs font-bold">{value}</p>
    </div>
  );
}
