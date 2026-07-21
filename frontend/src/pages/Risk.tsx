import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { useSignal } from "../api/hooks";
import type { InstrumentSymbol } from "../types";

// MCX lot sizes (units per lot). Verify against the current NCDEX/MCX contract
// spec before relying on this for real position sizing -- lot sizes change
// periodically and vary by contract month.
const LOT_SIZE: Record<InstrumentSymbol, number> = {
  CRUDEOIL: 100,
  NATURALGAS: 1250,
  GOLD: 100,
  SILVER: 30,
};

export function Risk() {
  const { risk, setRisk } = useAppStore();
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const { data: signal } = useSignal(symbol);

  const trade = signal && !signal.error ? signal.trade : null;
  const tradeIsLive = trade && trade.action !== "NO TRADE";

  const riskAmount = (risk.capital * risk.riskPercent) / 100;
  const perUnitRisk =
    tradeIsLive && trade.premiumEntry !== undefined && trade.premiumStop !== undefined
      ? Math.abs(trade.premiumEntry - trade.premiumStop)
      : null;
  const lotSize = LOT_SIZE[symbol];
  const unitsAffordable = perUnitRisk && perUnitRisk > 0 ? Math.floor(riskAmount / perUnitRisk) : null;
  const lots = unitsAffordable !== null ? Math.floor(unitsAffordable / lotSize) : null;
  const marginNote = "Margin requirement varies by broker/contract — check your broker's margin calculator before ordering.";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((sym) => (
          <button
            key={sym}
            onClick={() => setSymbol(sym)}
            className={`flex-1 rounded-xl py-2 text-sm font-bold ${
              symbol === sym ? "bg-gradient-to-r from-orange-500 to-pink-600 text-white" : "bg-white card text-[var(--color-muted)]"
            }`}
          >
            {sym}
          </button>
        ))}
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-xs font-bold text-[var(--color-muted)] uppercase">Position Size Calculator</p>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)] text-xs">Capital (₹)</span>
          <input
            type="number"
            value={risk.capital}
            onChange={(e) => setRisk({ capital: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-[var(--color-muted)] text-xs">Risk % per trade</span>
          <input
            type="number"
            value={risk.riskPercent}
            onChange={(e) => setRisk({ riskPercent: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] px-3 py-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Stat label="Risk Amount" value={`₹${riskAmount.toFixed(0)}`} />
          <Stat label="Lot Size" value={`${lotSize}`} />
          <Stat label="Suggested Lots" value={lots !== null ? String(lots) : "—"} />
          <Stat label="Max Loss" value={perUnitRisk !== null && lots !== null ? `₹${(perUnitRisk * lots * lotSize).toFixed(0)}` : "—"} />
        </div>
        {!tradeIsLive && (
          <p className="text-xs text-[var(--color-muted)]">No live trade signal for {symbol} right now — showing calculator only.</p>
        )}
        <p className="text-[11px] text-[var(--color-muted)]">{marginNote}</p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
