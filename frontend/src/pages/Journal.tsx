import { useMemo, useState } from "react";
import { Trash2, Download } from "lucide-react";
import { usePortfolio, useCreateTrade, useUpdateTrade, useDeleteTrade } from "../api/hooks";
import { CardSkeleton } from "../components/Skeleton";
import { computePortfolioSummary } from "../utils/portfolioStats";
import type { InstrumentSymbol, OptionSide, PortfolioTrade } from "../types";

const LOT_SIZE: Record<InstrumentSymbol, number> = { CRUDEOIL: 100, NATURALGAS: 1250, GOLD: 100, SILVER: 30 };

type RangeKey = "today" | "yesterday" | "week" | "month" | "all";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All" },
];

function inRange(dateStr: string, range: RangeKey): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr);
  const now = new Date();
  if (range === "today") return d.toDateString() === now.toDateString();
  if (range === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return d.toDateString() === y.toDateString();
  }
  if (range === "week") {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return d >= weekAgo && d <= now;
  }
  // month
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function toCSV(trades: PortfolioTrade[]): string {
  const headers = ["symbol", "optSide", "strike", "entryPrice", "exitPrice", "quantity", "lotSize", "stopLoss", "target", "entryDate", "exitDate", "status", "pnl", "source", "notes"];
  const rows = trades.map((t) => headers.map((h) => csvCell((t as any)[h])).join(","));
  return [headers.map(csvCell).join(","), ...rows].join("\n");
}

function downloadCSV(trades: PortfolioTrade[]) {
  const blob = new Blob([toCSV(trades)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kumar-signals-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Journal() {
  const { data: trades, isLoading, error } = usePortfolio();
  const createTrade = useCreateTrade();
  const updateTrade = useUpdateTrade();
  const deleteTrade = useDeleteTrade();
  const [showForm, setShowForm] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const all = trades ?? [];
    return all.filter((t) => {
      const refDate = t.exitDate ?? t.entryDate;
      if (!inRange(refDate, range)) return false;
      if (search && !`${t.symbol} ${t.strike ?? ""} ${t.optSide ?? ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [trades, range, search]);

  const summary = useMemo(() => computePortfolioSummary(filtered), [filtered]);
  const openTrades = filtered.filter((t) => t.status === "OPEN");
  const closedTrades = filtered.filter((t) => t.status === "CLOSED");

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">Journal</p>
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Signal history + trade journal — logged automatically from AI Trade calls or added manually. Stored in Cloudflare KV, so it
            survives across devices.
          </p>
        </div>
        <button
          onClick={() => downloadCSV(filtered)}
          disabled={!filtered.length}
          className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--color-surface-soft)] disabled:opacity-40"
        >
          <Download size={14} /> CSV
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold ${
              range === r.key ? "bg-slate-900 text-white" : "bg-[var(--color-surface-soft)] text-[var(--color-muted)]"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Search by symbol or strike…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm"
      />

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
            {openTrades.length === 0 && <p className="text-xs text-[var(--color-muted)] px-1">No open positions in this range.</p>}
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
                    {t.source && t.source !== "manual" ? ` · from ${t.source === "master-ai" ? "AI Trade" : "Signal"}` : ""}
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
                    <button onClick={() => setClosingId(t.id)} className="w-full py-1.5 rounded-lg text-xs font-bold bg-[var(--color-surface-soft)]">
                      Close position
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle>Closed trades</SectionTitle>
            {closedTrades.length === 0 && <p className="text-xs text-[var(--color-muted)] px-1">No closed trades in this range.</p>}
            <div className="space-y-2">
              {closedTrades.map((t) => (
                <ClosedTradeCard key={t.id} trade={t} onDelete={() => deleteTrade.mutate(t.id)} onNote={(patch) => updateTrade.mutate({ id: t.id, patch })} />
              ))}
            </div>
          </section>
        </>
      )}

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed px-1">
        Educational reference only. This ledger does not place real orders or read your broker account.
      </p>
    </div>
  );
}

function ClosedTradeCard({ trade: t, onDelete, onNote }: { trade: PortfolioTrade; onDelete: () => void; onNote: (patch: Partial<PortfolioTrade>) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button className="text-left flex-1" onClick={() => setOpen((o) => !o)}>
          <p className="text-sm font-bold">
            {t.symbol}
            {t.strike ? ` ${t.strike} ${t.optSide}` : ""}
          </p>
          <p className="text-[11px] text-[var(--color-muted)]">
            ₹{t.entryPrice} → ₹{t.exitPrice} · {t.quantity} lot(s) ·{" "}
            {t.exitDate ? new Date(t.exitDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : ""}
          </p>
        </button>
        <div className="flex items-center gap-2">
          <p className={`text-sm font-black ${(t.pnl ?? 0) >= 0 ? "text-[var(--color-buy)]" : "text-[var(--color-sell)]"}`}>
            {(t.pnl ?? 0) >= 0 ? "+" : ""}
            ₹{(t.pnl ?? 0).toFixed(0)}
          </p>
          <button onClick={onDelete} className="text-[var(--color-muted)]">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 pt-1 border-t border-[var(--color-border)]">
          <JournalField label="Notes" defaultValue={t.notes} onSave={(v) => onNote({ notes: v })} />
          <JournalField label="Mistakes" defaultValue={t.mistakes} onSave={(v) => onNote({ mistakes: v })} />
          <JournalField label="Lessons" defaultValue={t.lessons} onSave={(v) => onNote({ lessons: v })} />
          <JournalField label="Emotion" defaultValue={t.emotion} onSave={(v) => onNote({ emotion: v })} />
        </div>
      )}
    </div>
  );
}

function JournalField({ label, defaultValue, onSave }: { label: string; defaultValue?: string; onSave: (v: string) => void }) {
  return (
    <label className="block text-xs">
      <span className="text-[var(--color-muted)]">{label}</span>
      <textarea
        defaultValue={defaultValue ?? ""}
        onBlur={(e) => {
          if (e.target.value !== (defaultValue ?? "")) onSave(e.target.value);
        }}
        rows={2}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs resize-none"
      />
    </label>
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
