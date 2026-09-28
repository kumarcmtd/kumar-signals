import { TrendingUp, TrendingDown, Hourglass, PauseCircle, Moon, Zap, CheckCircle2, Clock, AlertTriangle, XCircle } from "lucide-react";
import type { DecisionResult, Verdict } from "../../utils/buyDecisionEngine";
import type { EntryCheck, OptionPick } from "../../hooks/useBuyDecision";

interface Look {
  from: string;
  to: string;
  Icon: typeof TrendingUp;
  title: string;
  sub: string;
}

function lookFor(v: Verdict, r: DecisionResult): Look {
  const lean = r.side === "CE" ? "up (CE side)" : r.side === "PE" ? "down (PE side)" : null;
  switch (v) {
    case "BUY_CE":
      return { from: "#047857", to: "#10B981", Icon: TrendingUp, title: "BUY CE", sub: "Uptrend confirmed on closed candles, with the bigger trend behind it." };
    case "BUY_PE":
      return { from: "#9F1239", to: "#E11D48", Icon: TrendingDown, title: "BUY PE", sub: "Downtrend confirmed on closed candles, with the bigger trend behind it." };
    case "FORMING_CE":
      return { from: "#B45309", to: "#F59E0B", Icon: Hourglass, title: "CE SETUP FORMING", sub: "Qualified on the last close — not a buy until one more candle confirms." };
    case "FORMING_PE":
      return { from: "#B45309", to: "#F59E0B", Icon: Hourglass, title: "PE SETUP FORMING", sub: "Qualified on the last close — not a buy until one more candle confirms." };
    case "EVENT_WAIT":
      return { from: "#7C2D12", to: "#EA580C", Icon: Zap, title: "WAIT — EIA REPORT", sub: "Scheduled report window. Price can jump either way in seconds." };
    case "CLOSED":
      return { from: "#0F172A", to: "#334155", Icon: Moon, title: "MARKET CLOSED", sub: "Read at the last close, for planning the next session." };
    default:
      return {
        from: "#312E81",
        to: "#4F46E5",
        Icon: PauseCircle,
        title: "WAIT",
        sub: lean ? `Leaning ${lean}, but not enough agrees yet. No trade is also a position.` : "No clear edge either way. No trade is also a position.",
      };
  }
}

const TECH_LABEL: Record<Verdict, string> = {
  BUY_CE: "BUY CE", BUY_PE: "BUY PE", FORMING_CE: "CE setup forming", FORMING_PE: "PE setup forming", WAIT: "WAIT", EVENT_WAIT: "WAIT", CLOSED: "WAIT",
};

function Ring({ value }: { value: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-[76px] h-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="w-full h-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="7" />
        <circle cx="38" cy="38" r={r} fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-[19px] font-black leading-none">{value}</span>
        <span className="text-[8px] font-bold uppercase tracking-wide opacity-80 mt-0.5">agree</span>
      </div>
    </div>
  );
}

const ENTRY_TONE = {
  ok: { bg: "#ECFDF5", ink: "#047857", Icon: CheckCircle2 },
  warn: { bg: "#FFFBEB", ink: "#B45309", Icon: AlertTriangle },
  bad: { bg: "#FEF2F2", ink: "#B91C1C", Icon: XCircle },
} as const;

export function VerdictHero({
  result, name, pick, entry, nextCloseIn,
}: { result: DecisionResult; name: string; pick: OptionPick | null; entry: EntryCheck | null; nextCloseIn: number | null }) {
  const look = lookFor(result.verdict, result);
  const buying = result.verdict === "BUY_CE" || result.verdict === "BUY_PE";
  const showTechnical = (result.verdict === "CLOSED" || result.verdict === "EVENT_WAIT") && result.technical !== "WAIT";

  return (
    <div className="space-y-2">
      <div className="rounded-3xl p-4 text-white relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})`, boxShadow: `0 12px 28px ${look.to}55` }}>
        <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full" style={{ background: "rgba(255,255,255,.08)" }} />
        <div className="absolute -left-10 -bottom-14 w-44 h-44 rounded-full" style={{ background: "rgba(255,255,255,.06)" }} />

        <div className="relative flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[.14em] opacity-80">{name} · decision</p>
            <p className="text-[28px] font-black leading-tight flex items-center gap-2 mt-0.5">
              <look.Icon size={26} strokeWidth={2.6} />
              {look.title}
            </p>
            {buying && pick && (
              <p className="text-[14px] font-extrabold mt-0.5">
                {name} {pick.strike} {pick.side}
                {pick.ltp !== null && <span className="font-bold opacity-85"> · ₹{pick.ltp.toFixed(2)}</span>}
              </p>
            )}
          </div>
          <Ring value={result.strength} />
        </div>

        <p className="relative text-[12px] leading-snug mt-2 opacity-95">{look.sub}</p>
        {showTechnical && (
          <p className="relative text-[11.5px] font-bold mt-1.5 rounded-lg px-2 py-1 inline-block" style={{ background: "rgba(255,255,255,.16)" }}>
            Chart alone says: {TECH_LABEL[result.technical]}
          </p>
        )}

        <div className="relative flex flex-wrap gap-1.5 mt-3">
          {result.since && buying && <Chip>Confirmed since {result.since}</Chip>}
          {result.lastClosedAt && <Chip>Last closed candle {result.lastClosedAt}</Chip>}
          {nextCloseIn !== null && result.verdict !== "CLOSED" && (
            <Chip>
              <Clock size={10} className="inline -mt-0.5 mr-0.5" />
              Next check in {nextCloseIn} min
            </Chip>
          )}
        </div>

        {(result.waitingFor.length > 0 && !buying && result.verdict !== "CLOSED") && (
          <div className="relative mt-3 rounded-2xl p-2.5" style={{ background: "rgba(255,255,255,.14)" }}>
            <p className="text-[10px] font-black uppercase tracking-wide opacity-90 mb-1">Waiting for</p>
            <ul className="space-y-1">
              {result.waitingFor.map((w) => (
                <li key={w} className="text-[11.5px] leading-snug flex gap-1.5">
                  <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {entry && (
        <div className="rounded-2xl px-3 py-2 flex items-start gap-2" style={{ background: ENTRY_TONE[entry.tone].bg }}>
          {(() => {
            const T = ENTRY_TONE[entry.tone];
            return <T.Icon size={15} className="shrink-0 mt-[1px]" style={{ color: T.ink }} />;
          })()}
          <p className="text-[11.5px] font-semibold leading-snug" style={{ color: ENTRY_TONE[entry.tone].ink }}>{entry.text}</p>
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold rounded-full px-2 py-[3px]" style={{ background: "rgba(255,255,255,.18)" }}>
      {children}
    </span>
  );
}
