import { useEffect, useState, type ReactNode } from "react";
import { useOptionsAnalytics, useMarketStatus } from "../api/hooks";
import type { InstrumentSymbol, OptionRowAnalytics } from "../types";

function fmt(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function Options() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("CRUDEOIL");
  const { data, isLoading, error } = useOptionsAnalytics(symbol);
  const { data: market } = useMarketStatus();
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);

  useEffect(() => {
    if (data && !data.error && data.atmStrike !== null) setSelectedStrike(data.atmStrike);
  }, [data?.atmStrike, data?.error]);

  const biasColor = data?.bias === "bullish" ? "text-[var(--color-buy)]" : data?.bias === "bearish" ? "text-[var(--color-sell)]" : "text-[var(--color-muted)]";
  const selectedRow: OptionRowAnalytics | undefined = data && !data.error ? data.rows.find((r) => r.strike === selectedStrike) : undefined;

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
      {error && <div className="card p-4 text-sm text-[var(--color-sell)]">{(error as Error).message}</div>}
      {data?.error && (
        <div className="card p-4 text-sm text-[var(--color-sell)]">
          {market && !market.isOpen
            ? `Option chain data isn't available while the market is closed. ${market.mcxStatus}`
            : data.error}
        </div>
      )}

      {data && !data.error && (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="font-bold">{data.tradingSymbol}</span>
              <span className="text-[var(--color-muted)]">Expiry {data.expiry}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Stat label="Spot" value={`₹${fmt(data.spot)}`} />
              <Stat label="ATM Strike" value={fmt(data.atmStrike, 0)} />
              <Stat label="Max Pain" value={fmt(data.maxPain, 0)} />
              <Stat label="PCR" value={`${fmt(data.pcr)} `} extra={<span className={`text-[10px] font-bold ${biasColor}`}>{data.bias.toUpperCase()}</span>} />
            </div>
          </div>

          <div className="card p-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--color-muted)]">
                  <th className="px-2 py-1.5 text-right">Call IV</th>
                  <th className="px-2 py-1.5 text-right">Call LTP</th>
                  <th className="px-2 py-1.5 text-right">Call OI</th>
                  <th className="px-2 py-1.5 text-center font-bold">Strike</th>
                  <th className="px-2 py-1.5 text-left">Put OI</th>
                  <th className="px-2 py-1.5 text-left">Put LTP</th>
                  <th className="px-2 py-1.5 text-left">Put IV</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const isAtm = row.strike === data.atmStrike;
                  const isSelected = row.strike === selectedStrike;
                  return (
                    <tr
                      key={row.strike}
                      onClick={() => setSelectedStrike(row.strike)}
                      className={`cursor-pointer ${isSelected ? "bg-blue-50" : isAtm ? "bg-amber-50" : ""}`}
                    >
                      <td className="px-2 py-1.5 text-right">{fmt(row.call.iv, 1)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{fmt(row.call.ltp)}</td>
                      <td className="px-2 py-1.5 text-right">{fmt(row.call.oi, 0)}</td>
                      <td className="px-2 py-1.5 text-center font-bold">{row.strike}</td>
                      <td className="px-2 py-1.5 text-left">{fmt(row.put.oi, 0)}</td>
                      <td className="px-2 py-1.5 text-left font-semibold">{fmt(row.put.ltp)}</td>
                      <td className="px-2 py-1.5 text-left">{fmt(row.put.iv, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedRow && (
            <div className="card p-4 space-y-3">
              <p className="text-xs font-bold text-[var(--color-muted)] uppercase">Strike {selectedRow.strike} — Greeks</p>
              <div className="grid grid-cols-2 gap-3">
                <GreeksCard title="Call" leg={selectedRow.call} accent="buy" />
                <GreeksCard title="Put" leg={selectedRow.put} accent="sell" />
              </div>
            </div>
          )}

          <p className="text-[11px] text-[var(--color-muted)] px-1">
            Greeks and IV are computed with the Black-76 model (correct for options on futures, unlike plain
            Black-Scholes) using a flat 6.5% risk-free rate approximation. Max Pain is the strike where option writers
            collectively owe the least at expiry — a common but not guaranteed magnet for price. Educational reference
            only, not financial advice.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, extra }: { label: string; value: string | number; extra?: ReactNode }) {
  return (
    <div className="rounded-xl bg-[var(--color-surface-soft)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-muted)]">{label}</p>
      <p className="text-sm font-bold flex items-center gap-1.5">
        {value}
        {extra}
      </p>
    </div>
  );
}

function GreeksCard({ title, leg, accent }: { title: string; leg: OptionRowAnalytics["call"]; accent: "buy" | "sell" }) {
  const bg = accent === "buy" ? "bg-[var(--color-buy-soft)]" : "bg-[var(--color-sell-soft)]";
  const text = accent === "buy" ? "text-emerald-700" : "text-rose-700";
  return (
    <div className={`rounded-xl p-3 ${bg}`}>
      <p className={`text-xs font-bold mb-2 ${text}`}>{title}</p>
      <div className="space-y-1 text-xs">
        <Row label="LTP" value={`₹${fmt(leg.ltp)}`} />
        <Row label="IV" value={`${fmt(leg.iv, 1)}%`} />
        <Row label="Delta" value={fmt(leg.delta, 3)} />
        <Row label="Gamma" value={fmt(leg.gamma, 4)} />
        <Row label="Theta" value={fmt(leg.theta, 2)} />
        <Row label="Vega" value={fmt(leg.vega, 2)} />
        <Row label="Rho" value={fmt(leg.rho, 2)} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="opacity-60">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
