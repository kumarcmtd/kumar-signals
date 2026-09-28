import { useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, XCircle } from "lucide-react";
import { useOptionsAnalytics } from "../../api/hooks";
import { useAppStore } from "../../store/appStore";
import { LOT_SIZE, sizePosition, type GuardSymbol } from "../../utils/capitalGuard";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const NAME: Record<GuardSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const STOP_PCTS = [20, 30, 40];

export function SizeCalculator() {
  const risk = useAppStore((s) => s.risk);
  const [symbol, setSymbol] = useState<GuardSymbol>("NATURALGAS");
  const [side, setSide] = useState<"CE" | "PE">("CE");
  const { data: chain } = useOptionsAnalytics(symbol);
  const rows = chain && !chain.error ? chain.rows : [];
  const [strike, setStrike] = useState<number | null>(null);
  const [premiumText, setPremiumText] = useState("");
  const [stopPct, setStopPct] = useState(30);

  // Default to the at-the-money strike whenever the symbol's chain arrives.
  useEffect(() => {
    if (chain && !chain.error) setStrike(chain.atmStrike);
  }, [symbol, chain?.atmStrike]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = rows.find((r) => r.strike === strike);
  const liveLtp = row ? (side === "CE" ? row.call.ltp : row.put.ltp) : null;
  useEffect(() => {
    if (liveLtp !== null) setPremiumText(String(liveLtp));
  }, [liveLtp, strike, side]);

  const premium = Number(premiumText);
  const stopPremium = Math.round(premium * (1 - stopPct / 100) * 100) / 100;
  const r = useMemo(
    () => sizePosition({ capital: risk.capital, riskPct: risk.riskPercent, premium, stopPremium, lotSize: LOT_SIZE[symbol] }),
    [risk.capital, risk.riskPercent, premium, stopPremium, symbol]
  );
  const ok = r.verdict === "ok";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#4F46E5,#7C3AED)" }}>
          <Calculator size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">How many lots can I buy?</p>
          <p className="text-[10px] text-slate-500">Before every trade. Size decides survival more than the call does.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
          {(["NATURALGAS", "CRUDEOIL"] as const).map((s) => (
            <button key={s} onClick={() => setSymbol(s)} className="flex-1 rounded-lg py-1.5 text-[11px] font-black" style={symbol === s ? { background: "#fff", color: "#4338CA" } : { color: "#64748B" }}>
              {s === "NATURALGAS" ? "NG" : "Crude"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
          {(["CE", "PE"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} className="flex-1 rounded-lg py-1.5 text-[11px] font-black" style={side === s ? { background: "#fff", color: s === "CE" ? "#047857" : "#BE123C" } : { color: "#64748B" }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] font-bold text-slate-500">
          Strike {chain && !chain.error && <span className="font-normal">(exp {chain.expiry.slice(5)})</span>}
          <select value={strike ?? ""} onChange={(e) => setStrike(Number(e.target.value))} className="mt-0.5 w-full rounded-xl border border-slate-200 px-2 py-2 text-[13px] font-black text-slate-800 bg-white">
            {rows.length === 0 && <option value="">—</option>}
            {rows.map((r2) => (
              <option key={r2.strike} value={r2.strike}>
                {r2.strike}{r2.strike === chain?.atmStrike ? " (ATM)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[10px] font-bold text-slate-500">
          Premium ₹ {liveLtp !== null && <span className="font-normal">(live)</span>}
          <input inputMode="decimal" value={premiumText} onChange={(e) => setPremiumText(e.target.value)} className="mt-0.5 w-full rounded-xl border border-slate-200 px-2 py-2 text-[13px] font-black text-slate-800" />
        </label>
      </div>

      <div>
        <p className="text-[10px] font-bold text-slate-500 mb-1">Exit if the premium falls by</p>
        <div className="flex gap-1.5">
          {STOP_PCTS.map((p) => (
            <button key={p} onClick={() => setStopPct(p)} className="flex-1 rounded-xl py-1.5 text-[12px] font-black border" style={stopPct === p ? { background: "#EEF2FF", borderColor: "#6366F1", color: "#4338CA" } : { borderColor: "#E2E8F0", color: "#64748B" }}>
              {p}%
            </button>
          ))}
        </div>
        {premium > 0 && <p className="text-[10.5px] text-slate-500 mt-1">Stop at ₹{stopPremium} premium.</p>}
      </div>

      {r.verdict !== "invalid" && (
        <div className="rounded-2xl p-3" style={{ background: ok ? "linear-gradient(160deg,#ECFDF5,#D1FAE5)" : "linear-gradient(160deg,#FFF1F2,#FFE4E6)" }}>
          <div className="flex items-center gap-2">
            {ok ? <CheckCircle2 size={22} className="text-emerald-600" /> : <XCircle size={22} className="text-rose-600" />}
            <p className="text-[20px] font-black" style={{ color: ok ? "#047857" : "#BE123C" }}>
              {ok ? `${r.lots} lot${r.lots > 1 ? "s" : ""} max` : "0 lots — skip"}
            </p>
          </div>
          <p className="text-[11.5px] leading-snug mt-1" style={{ color: ok ? "#065F46" : "#9F1239" }}>{r.why}</p>
          <div className="grid grid-cols-3 gap-1.5 mt-2 text-center">
            <Stat label="Risk / lot" value={inr(r.riskPerLot)} />
            <Stat label="Cost / lot" value={inr(r.costPerLot)} />
            <Stat label="1 lot risks" value={`${r.riskPctOfOneLot.toFixed(1)}%`} />
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-400 leading-snug">
        {NAME[symbol]} lot = {LOT_SIZE[symbol].toLocaleString("en-IN")} units, so every ₹1 of premium is ₹{LOT_SIZE[symbol].toLocaleString("en-IN")} per lot. Check margin in your broker app.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 py-1.5">
      <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
      <p className="text-[12.5px] font-black text-slate-800">{value}</p>
    </div>
  );
}
