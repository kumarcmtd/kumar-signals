// The top card while MCX is shut (nights, weekends, before 9:00 AM). The live
// pullback read needs today's intraday candles, so after the bell it had no
// price and no levels and showed blank fields with a "wait for a 1H close"
// instruction. This shows what IS known instead: the last session's close and
// range, how far global prices have moved since MCX shut, and when it reopens.

import { Moon, ArrowRight } from "lucide-react";
import { useOvernightTracker, usePrices } from "../api/hooks";
import { nextMcxOpen } from "../utils/mcxSession";

const px = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
const NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

export function MarketClosedCard({ symbol, preOpen, onOpen }: { symbol: "CRUDEOIL" | "NATURALGAS"; preOpen: boolean; onOpen?: () => void }) {
  const prices = usePrices();
  const overnight = useOvernightTracker();
  const card = Array.isArray(prices.data) ? prices.data.find((p) => p.symbol === symbol && typeof p.ltp === "number") : undefined;
  const moves = (overnight.data?.moves ?? []).filter((m) => m.tracksMCX === symbol && typeof m.changePct === "number");
  const next = nextMcxOpen(Date.now());
  const sessionDay = card?.lastUpdated ? new Date(Date.parse(card.lastUpdated) + 5.5 * 3600_000).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : null;
  return (
    <button type="button" onClick={onOpen} disabled={!onOpen} className="w-full text-left rounded-2xl overflow-hidden bg-slate-50 border-[1.5px] border-slate-300 transition-transform active:scale-[.99] disabled:active:scale-100">
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Moon size={18} className="text-slate-500 shrink-0" strokeWidth={2.4} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-black leading-tight text-slate-700">{preOpen ? "Pre-open — trading starts 9:00 AM IST" : "Market closed"}</p>
            <p className="text-[10.5px] font-bold leading-tight text-slate-500">{preOpen ? "Live reads start with the first candles." : `Next session ${next.label}`}</p>
          </div>
          {onOpen && <ArrowRight size={15} className="text-slate-400 shrink-0" />}
        </div>
        {card && (
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            {[
              [`${NAME[symbol]} close`, `${px(card.ltp)}`, typeof card.changePercent === "number" ? pct(card.changePercent) : ""],
              ["Session high", px(card.high), ""],
              ["Session low", px(card.low), ""],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-lg bg-white px-2 py-1">
                <p className="text-[8.5px] font-bold uppercase text-slate-400">{k}</p>
                <p className="text-[11px] font-black text-slate-700 leading-tight tabular-nums">{v}</p>
                {sub && <p className={`text-[9px] font-bold ${sub.startsWith("+") ? "text-emerald-600" : "text-rose-600"}`}>{sub}</p>}
              </div>
            ))}
          </div>
        )}
        <p className="text-[9.5px] mt-1.5 leading-snug text-slate-500">
          {sessionDay ? `Last session ${sessionDay}. ` : ""}
          {moves.length ? `Since MCX closed: ${moves.map((m) => `${m.name.replace(/ \((NYMEX|ICE)\)/, "")} ${pct(m.changePct as number)}`).join(" · ")}. ` : ""}
          The high and low are the levels to watch at the open; live pullback reads resume when MCX opens.
        </p>
      </div>
    </button>
  );
}
