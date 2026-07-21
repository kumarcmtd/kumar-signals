import { useState } from "react";
import { useSignal } from "../api/hooks";
import type { InstrumentSymbol } from "../types";

export function Options() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const { data: signal, isLoading } = useSignal(symbol);

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

      {isLoading && <div className="card p-4 text-sm text-[var(--color-muted)]">Loading option chain…</div>}

      {signal && !signal.error && (
        <div className="card p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="font-bold">{signal.tradingSymbol}</span>
            <span className="text-[var(--color-muted)]">Expiry {signal.expiry}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Stat label="PCR" value={signal.trade.pcr ?? "-"} />
            <Stat label="Spot" value={`₹${signal.currentPrice}`} />
          </div>
        </div>
      )}

      <div className="card p-4 space-y-2">
        <p className="text-xs font-bold text-[var(--color-muted)] uppercase">Coming soon</p>
        <p className="text-sm text-[var(--color-muted)]">
          Max Pain, IV, and Greeks (Delta/Gamma/Theta/Vega/Rho) require a Black-Scholes model on the backend — Upstox's
          option chain returns OI/LTP but not Greeks directly. Tracked as a follow-up build.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}
