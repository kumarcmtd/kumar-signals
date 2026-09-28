import { useState } from "react";
import { Briefcase, Plus, Trash2, AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useOptionsAnalytics } from "../../api/hooks";
import { useBuyDecision } from "../../hooks/useBuyDecision";
import { checkPosition, type GuardPosition, type GuardSymbol, type LiveLeg } from "../../utils/capitalGuard";

const inr = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const TONE = {
  bad: { ink: "#B91C1C", bg: "#FEF2F2", Icon: AlertOctagon },
  warn: { ink: "#B45309", bg: "#FFFBEB", Icon: AlertTriangle },
  ok: { ink: "#047857", bg: "#ECFDF5", Icon: CheckCircle2 },
} as const;

function AddForm({ onDone }: { onDone: () => void }) {
  const add = useAppStore((s) => s.addGuardPosition);
  const [symbol, setSymbol] = useState<GuardSymbol>("NATURALGAS");
  const [side, setSide] = useState<"CE" | "PE">("CE");
  const [strike, setStrike] = useState("");
  const [lots, setLots] = useState("1");
  const [avg, setAvg] = useState("");
  const valid = Number(strike) > 0 && Number(lots) > 0 && Number(avg) > 0;
  const input = "w-full rounded-xl border border-slate-200 px-2 py-2 text-[13px] font-black text-slate-800";
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={symbol} onChange={(e) => setSymbol(e.target.value as GuardSymbol)} className={input}>
          <option value="NATURALGAS">Natural Gas</option>
          <option value="CRUDEOIL">Crude Oil</option>
        </select>
        <select value={side} onChange={(e) => setSide(e.target.value as "CE" | "PE")} className={input}>
          <option value="CE">CE</option>
          <option value="PE">PE</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input className={input} inputMode="decimal" placeholder="Strike" value={strike} onChange={(e) => setStrike(e.target.value)} />
        <input className={input} inputMode="numeric" placeholder="Lots" value={lots} onChange={(e) => setLots(e.target.value)} />
        <input className={input} inputMode="decimal" placeholder="Avg ₹" value={avg} onChange={(e) => setAvg(e.target.value)} />
      </div>
      <button
        disabled={!valid}
        onClick={() => {
          add({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, symbol, side, strike: Number(strike), lots: Math.round(Number(lots)), avg: Number(avg), addedAt: Date.now() });
          onDone();
        }}
        className="w-full rounded-xl py-2 text-[12.5px] font-black text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#4F46E5,#7C3AED)" }}
      >
        Add position
      </button>
    </div>
  );
}

/** One symbol's positions, checked against that symbol's live chain and chart read. */
function SymbolPositions({ symbol, positions, all }: { symbol: GuardSymbol; positions: GuardPosition[]; all: GuardPosition[] }) {
  const risk = useAppStore((s) => s.risk);
  const remove = useAppStore((s) => s.removeGuardPosition);
  const { data: chain } = useOptionsAnalytics(symbol);
  const { result } = useBuyDecision(symbol);
  // Only a confirmed chart read counts as support or opposition; anything
  // weaker (wait, forming) is "unclear" rather than a vote either way.
  const chartSide = result?.technical.startsWith("BUY") ? result.side : null;

  return (
    <>
      {positions.map((p) => {
        const row = chain && !chain.error ? chain.rows.find((r) => r.strike === p.strike) : undefined;
        const leg: LiveLeg | null = row ? { ltp: (p.side === "CE" ? row.call : row.put).ltp, theta: (p.side === "CE" ? row.call : row.put).theta ?? null } : null;
        const c = checkPosition(p, leg, risk.capital, risk.riskPercent, chartSide, all);
        const lossy = (c.pnl ?? 0) < 0;
        return (
          <div key={p.id} className="rounded-2xl border border-slate-100 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-black text-slate-800">
                  {symbol === "NATURALGAS" ? "NG" : "Crude"} {p.strike} {p.side}
                </p>
                <p className="text-[10.5px] text-slate-500">
                  {p.lots} lot{p.lots > 1 ? "s" : ""} @ ₹{p.avg} · LTP {c.ltp !== null ? `₹${c.ltp}` : "not in live chain"}
                  {chain && !chain.error && row && <span> (exp {chain.expiry.slice(5)})</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-black" style={{ color: c.pnl === null ? "#64748B" : lossy ? "#DC2626" : "#059669" }}>{c.pnl !== null ? inr(c.pnl) : "—"}</p>
                {c.pnlPctOfCapital !== null && <p className="text-[10px] font-bold text-slate-500">{c.pnlPctOfCapital.toFixed(1)}% of capital</p>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <Mini label="Rule stop" value={`₹${c.ruleStop}`} bad={c.pastRuleStop} />
              <Mini label="Decay / day" value={c.decayPerDay !== null ? inr(-c.decayPerDay) : "—"} />
              <Mini label="Chart" value={c.chart === "supports" ? "Supports" : c.chart === "against" ? "Against" : "Unclear"} bad={c.chart === "against"} />
            </div>
            <div className="space-y-1">
              {c.flags.map((f) => {
                const T = TONE[f.tone];
                return (
                  <div key={f.text} className="flex gap-1.5 rounded-xl px-2 py-1.5" style={{ background: T.bg }}>
                    <T.Icon size={13} className="shrink-0 mt-[1px]" style={{ color: T.ink }} />
                    <p className="text-[11px] leading-snug" style={{ color: T.ink }}>{f.text}</p>
                  </div>
                );
              })}
            </div>
            <button onClick={() => remove(p.id)} className="text-[10.5px] font-bold text-slate-400 flex items-center gap-1">
              <Trash2 size={11} /> Remove (closed it)
            </button>
          </div>
        );
      })}
    </>
  );
}

function Mini({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-xl py-1.5" style={{ background: bad ? "#FEF2F2" : "#F8FAFC" }}>
      <p className="text-[8.5px] font-bold uppercase text-slate-500">{label}</p>
      <p className="text-[11.5px] font-black" style={{ color: bad ? "#B91C1C" : "#1E293B" }}>{value}</p>
    </div>
  );
}

export function PositionsCard() {
  const positions = useAppStore((s) => s.guardPositions);
  const capital = useAppStore((s) => s.risk.capital);
  const [adding, setAdding] = useState(false);
  const ng = positions.filter((p) => p.symbol === "NATURALGAS");
  const cl = positions.filter((p) => p.symbol === "CRUDEOIL");
  const sides = new Set(positions.map((p) => `${p.symbol}-${p.side}`));

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#0EA5E9,#2563EB)" }}>
            <Briefcase size={16} />
          </span>
          <div>
            <p className="text-[13px] font-black text-slate-800">My open positions</p>
            <p className="text-[10px] text-slate-500">Each checked against your rules, time decay and the chart.</p>
          </div>
        </div>
        <button onClick={() => setAdding((a) => !a)} className="rounded-xl p-2 bg-indigo-50 text-indigo-600">
          <Plus size={16} />
        </button>
      </div>

      {adding && <AddForm onDone={() => setAdding(false)} />}
      {positions.length === 0 && !adding && <p className="text-[11.5px] text-slate-500">No positions added. Tap + to add what you hold in your broker app.</p>}
      {positions.length > 1 && sides.size === 1 && (
        <p className="text-[11px] font-bold rounded-xl px-2.5 py-2 bg-amber-50 text-amber-800">
          All {positions.length} positions are on one side of one market — a single move against it hits all of them at once.
        </p>
      )}
      {ng.length > 0 && <SymbolPositions symbol="NATURALGAS" positions={ng} all={positions} />}
      {cl.length > 0 && <SymbolPositions symbol="CRUDEOIL" positions={cl} all={positions} />}
      {positions.length > 0 && <p className="text-[10px] text-slate-400">Capital used for the % figures: ₹{capital.toLocaleString("en-IN")}. Rule stop = where this position's loss reaches your per-trade limit.</p>}
    </div>
  );
}
