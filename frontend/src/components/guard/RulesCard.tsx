import { useState } from "react";
import { BookOpenCheck, ChevronDown } from "lucide-react";
import { useAppStore } from "../../store/appStore";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function rules(capital: number, riskPct: number, dayPct: number) {
  const perTrade = (capital * riskPct) / 100;
  const perDay = (capital * dayPct) / 100;
  return [
    {
      title: `Risk ${riskPct}% a trade — ${inr(perTrade)} on ${inr(capital)}`,
      why: `Even good traders lose 5–8 trades in a row sometimes. At ${riskPct}% a trade, eight losers cost about ${Math.round(riskPct * 8)}% — painful but survivable. At 30% a trade, two losers end the account. The call quality matters less than this.`,
    },
    {
      title: "Decide the stop BEFORE you buy",
      why: "Before entering, write down the premium at which you are wrong. Once in a trade, the mind finds reasons to hold a loser. A stop decided earlier, with a calm mind, is the one that protects you.",
    },
    {
      title: "Never add to a losing option",
      why: "Buying more as the premium falls (averaging down) makes one wrong idea cost two or three times. Add only to a trade that is already working — or better, don't add at all while learning.",
    },
    {
      title: `Stop for the day at ${inr(perDay)} lost`,
      why: "After two or three losses, people trade to 'win it back' — bigger size, worse setups. That revenge trading is how one bad day becomes a lost month. The limit stops it before it starts.",
    },
    {
      title: "Option buyers fight time",
      why: "An option loses value every day (theta), faster near expiry. Price must move enough, soon enough. Holding a losing option overnight 'for tomorrow' pays decay plus gap risk. Prefer same-day trades while learning.",
    },
    {
      title: "Avoid the EIA report minutes",
      why: "Crude (Wednesday) and NG (Thursday) reports at ~8 PM IST can jump price either way in seconds. Premiums also swell before and collapse after. Wait 30 minutes after the report.",
    },
    {
      title: "Win-to-loss size beats win rate",
      why: "Winning 40% of trades with wins twice the size of losses makes money. Winning 70% with losses three times the wins loses money. Let winners reach their target; cut losers at the stop.",
    },
    {
      title: "One market, one side, one position",
      why: "Several CE positions in one symbol are one bet, not diversification. If that view is wrong, all of them lose together.",
    },
  ];
}

export function RulesCard() {
  const { capital, riskPercent, dailyLossPercent } = useAppStore((s) => s.risk);
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(140deg,#10B981,#0D9488)" }}>
          <BookOpenCheck size={16} />
        </span>
        <div>
          <p className="text-[13px] font-black text-slate-800">The rules — and why</p>
          <p className="text-[10px] text-slate-500">What keeps traders in the game. Tap each to learn.</p>
        </div>
      </div>
      {rules(capital, riskPercent, dailyLossPercent).map((r, i) => (
        <div key={r.title} className="border-b border-slate-100 last:border-0">
          <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between gap-2 py-2.5 text-left">
            <span className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
              <span className="text-[12px] font-extrabold text-slate-800">{r.title}</span>
            </span>
            <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open === i ? "rotate-180" : ""}`} />
          </button>
          {open === i && <p className="text-[11.5px] text-slate-600 leading-relaxed pb-2.5 pl-7">{r.why}</p>}
        </div>
      ))}
    </div>
  );
}
