import { useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldX, Pencil, Check } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { dayStatus } from "../../utils/capitalGuard";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

const LOOK = {
  ok: { from: "#065F46", to: "#10B981", Icon: ShieldCheck, title: "You can trade today", sub: "Within your daily loss limit." },
  careful: { from: "#92400E", to: "#F59E0B", Icon: ShieldAlert, title: "Careful — limit getting close", sub: "Only A+ setups, smallest size, or stop for today." },
  stop: { from: "#7F1D1D", to: "#DC2626", Icon: ShieldX, title: "STOP TRADING TODAY", sub: "Daily loss limit reached. No new trades until tomorrow — this rule is what protects the rest of your capital." },
} as const;

function NumField({ label, value, suffix, onSave }: { label: string; value: number; suffix?: string; onSave: (n: number) => void }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(String(value));
  return (
    <div className="rounded-2xl p-2.5" style={{ background: "rgba(255,255,255,.14)" }}>
      <p className="text-[9.5px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      {edit ? (
        <div className="flex items-center gap-1 mt-0.5">
          <input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg px-1.5 py-0.5 text-[14px] font-black text-slate-900"
          />
          <button
            onClick={() => {
              const n = Number(text.replace(/,/g, ""));
              if (Number.isFinite(n)) onSave(n);
              setEdit(false);
            }}
            className="rounded-lg bg-white/90 p-1 text-slate-900"
          >
            <Check size={14} />
          </button>
        </div>
      ) : (
        <button onClick={() => { setText(String(value)); setEdit(true); }} className="flex items-center gap-1 mt-0.5 text-[15px] font-black">
          {suffix === "%" ? `${value}%` : inr(value)}
          <Pencil size={11} className="opacity-70" />
        </button>
      )}
    </div>
  );
}

export function GuardHero() {
  const { risk, setRisk, guardDay, setGuardRealised } = useAppStore();
  const today = todayIst();
  const dayPnl = guardDay.date === today ? guardDay.realised : 0;
  const d = dayStatus(risk.capital, risk.dailyLossPercent, dayPnl);
  const look = LOOK[d.state];
  const bar = Math.min(100, d.usedPct);

  return (
    <div className="rounded-3xl p-4 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})`, boxShadow: `0 12px 28px ${look.to}50` }}>
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full" style={{ background: "rgba(255,255,255,.08)" }} />
      <p className="relative text-[10px] font-bold uppercase tracking-[.14em] opacity-80">Capital Guard · today</p>
      <p className="relative text-[22px] font-black leading-tight flex items-center gap-2 mt-0.5">
        <look.Icon size={24} /> {look.title}
      </p>
      <p className="relative text-[12px] opacity-95 mt-1 leading-snug">{look.sub}</p>

      <div className="relative mt-3">
        <div className="flex justify-between text-[10.5px] font-bold opacity-90">
          <span>Lost today {inr(d.used)}</span>
          <span>Limit {inr(d.limit)}</span>
        </div>
        <div className="h-2.5 rounded-full mt-1 overflow-hidden" style={{ background: "rgba(255,255,255,.25)" }}>
          <div className="h-full rounded-full bg-white" style={{ width: `${bar}%` }} />
        </div>
        {d.usedPct > 100 && <p className="text-[10.5px] font-bold mt-1">That is {(d.usedPct / 100).toFixed(1)}× your daily limit.</p>}
      </div>

      <div className="relative grid grid-cols-2 gap-2 mt-3">
        <NumField label="Today's P&L (from broker)" value={dayPnl} onSave={(n) => setGuardRealised(today, n)} />
        <NumField label="Capital" value={risk.capital} onSave={(n) => n > 0 && setRisk({ capital: n })} />
        <NumField label="Max loss / trade" value={risk.riskPercent} suffix="%" onSave={(n) => n > 0 && n <= 10 && setRisk({ riskPercent: n })} />
        <NumField label="Daily loss limit" value={risk.dailyLossPercent} suffix="%" onSave={(n) => n > 0 && n <= 20 && setRisk({ dailyLossPercent: n })} />
      </div>
      <p className="relative text-[10px] opacity-80 mt-2 leading-snug">
        Rules: lose at most {inr((risk.capital * risk.riskPercent) / 100)} on any one trade, and at most {inr(d.limit)} in a day. Copy "Day's P&L" from your broker
        app — this app cannot see your account.
      </p>
    </div>
  );
}
