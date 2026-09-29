import { useState } from "react";
import { Clock3, ChevronDown, Trophy } from "lucide-react";
import type { SymbolScorecard, TfRow, TfVerdict } from "../utils/timeframeScorecard";
import { MIN_SAMPLE } from "../utils/aiEdgeEngine";

const NAME = { NATURALGAS: "Natural Gas", CRUDEOIL: "Crude Oil" } as const;
const inr = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

const VERDICT: Record<TfVerdict, { text: string; ink: string; bg: string }> = {
  profitable: { text: "Made money", ink: "#00E676", bg: "rgba(0,230,118,.12)" },
  flat: { text: "About even", ink: "#FFC400", bg: "rgba(255,196,0,.12)" },
  losing: { text: "Lost money", ink: "#FF5252", bg: "rgba(255,82,82,.12)" },
  insufficient: { text: `Under ${MIN_SAMPLE} trades`, ink: "rgba(255,255,255,.45)", bg: "rgba(255,255,255,.06)" },
};

function Row({ r, maxAbs }: { r: TfRow; maxAbs: number }) {
  const [open, setOpen] = useState(false);
  const v = VERDICT[r.verdict];
  const width = maxAbs > 0 ? Math.max(3, (Math.abs(r.net) / maxAbs) * 100) : 0;
  const ink = r.net >= 0 ? "#00E676" : "#FF5252";
  return (
    <div className="rounded-xl p-2.5" style={{ background: "#1A1C27" }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-black text-white/90">{r.label}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-black tabular-nums" style={{ color: ink }}>{inr(r.net)}</span>
            <ChevronDown size={13} className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </div>
        <div className="h-1.5 rounded-full mt-1.5" style={{ background: "rgba(255,255,255,.06)" }}>
          <div className="h-full rounded-full" style={{ width: `${width}%`, background: ink, opacity: r.verdict === "insufficient" ? 0.4 : 1 }} />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-white/50">
          <span>
            {r.trades} trades · {r.winRate !== null ? `${r.winRate.toFixed(0)}% won` : "—"}
            {r.profitFactor !== null && ` · wins ÷ losses ${r.profitFactor.toFixed(2)}`}
          </span>
          <span className="font-bold rounded-full px-1.5 py-[1px]" style={{ color: v.ink, background: v.bg }}>{v.text}</span>
        </div>
      </button>
      {open && (
        <div className="mt-2 pt-2 space-y-1" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
          <p className="text-[10px] text-white/45">
            Avg win {r.avgWin !== null ? inr(r.avgWin) : "—"} · avg loss {r.avgLoss !== null ? inr(-r.avgLoss) : "—"}
          </p>
          {r.engines.map((e) => (
            <div key={e.label} className="flex justify-between text-[10.5px]">
              <span className="text-white/65">{e.label} <span className="text-white/35">({e.trades})</span></span>
              <span className="font-bold tabular-nums" style={{ color: e.net >= 0 ? "#00E676" : "#FF5252" }}>{inr(e.net)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SymbolBlock({ card }: { card: SymbolScorecard }) {
  const maxAbs = Math.max(0, ...card.rows.map((r) => Math.abs(r.net)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] font-black text-white/85">{NAME[card.symbol]}</p>
        <span className="text-[10px] text-white/35">{card.totalTrades} closed trades</span>
      </div>
      {card.best ? (
        <div className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: "linear-gradient(135deg,rgba(0,230,118,.16),rgba(0,194,255,.10))" }}>
          <Trophy size={15} className="text-[#00E676] shrink-0" />
          <p className="text-[11.5px] text-white/85 leading-snug">
            Best so far: <b className="text-[#00E676]">{card.best.label}</b> — {inr(card.best.net)} a lot over {card.best.trades} trades
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-white/45 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,.04)" }}>
          {card.totalTrades === 0 ? "No closed trades yet." : `No timeframe has made money over ${MIN_SAMPLE}+ trades yet.`}
        </p>
      )}
      {card.rows.map((r) => (
        <Row key={r.tf} r={r} maxAbs={maxAbs} />
      ))}
    </div>
  );
}

export function TimeframeScorecardCard({ cards, periodLabel }: { cards: Record<"NATURALGAS" | "CRUDEOIL", SymbolScorecard>; periodLabel: string }) {
  return (
    <section className="rounded-2xl p-3.5 space-y-3.5" style={{ background: "#14161F", border: "1px solid rgba(255,255,255,.07)" }}>
      <div>
        <div className="flex items-center gap-1.5">
          <Clock3 size={15} className="text-[#00C2FF]" />
          <h2 className="text-[13px] font-black text-white/85">Which timeframe made money</h2>
        </div>
        <p className="text-[10px] text-white/40 mt-1 leading-snug">
          Every engine's closed calls pooled by timeframe, {periodLabel.toLowerCase()}, in rupees at 1 lot. Tap a row to see which engines made or lost it.
        </p>
      </div>
      <SymbolBlock card={cards.NATURALGAS} />
      <SymbolBlock card={cards.CRUDEOIL} />
      <p className="text-[9.5px] text-white/35 leading-relaxed">
        "Multi-timeframe pages" are calls that blend several timeframes into one (Best Call, AI-Up…). A timeframe needs {MIN_SAMPLE}+ trades before it is
        called profitable or losing. Past results can change when the market changes.
      </p>
    </section>
  );
}
