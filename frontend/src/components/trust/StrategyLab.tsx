// "Proven strategies" on Ai-Trust: every strategy in utils/strategies tested
// on this market's own last 90 days (utils/strategyBacktest), a live call
// ONLY from the ones that passed, and which of the app's existing pages have
// actually earned (AI Edge, from their own logs).

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, ChevronRight } from "lucide-react";
import { useCandles, useHistory30m } from "../../api/hooks";
import { useAppStore } from "../../store/appStore";
import { testAll, liveSignals, PROVEN_RULE, type StratStats } from "../../utils/strategyBacktest";
import { STRATEGIES } from "../../utils/strategies";
import { computeEngineEdges } from "../../utils/aiEdgeEngine";
import { sessionBucketStart } from "../../utils/candleResample";
import type { Candle } from "../../types";

type Sym = "CRUDEOIL" | "NATURALGAS";
const NAME: Record<Sym, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };
const nameOf = (id: StratStats["strategy"]) => STRATEGIES.find((s) => s.id === id)!.name;
const r = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}R`);

function Market({ sym }: { sym: Sym }) {
  const hist = useHistory30m(sym, true);
  const today = useCandles(sym, "30");
  const minute = Math.floor(Date.now() / 60_000);
  const history = hist.data && "candles" in hist.data ? (hist.data.candles as Candle[]) : null;

  const result = useMemo(() => (history && history.length > 200 ? testAll(history) : null), [history]);
  const live = useMemo(() => {
    if (!history || !result) return [];
    const todayBars = today.data && "candles" in today.data ? today.data.candles : [];
    const merged = new Map<string, Candle>();
    for (const c of [...history, ...todayBars]) merged.set(c.date, c);
    const forming = sessionBucketStart(Date.now(), 30);
    const closed = [...merged.values()].filter((c) => Date.parse(c.date) < forming).sort((a, b) => a.date.localeCompare(b.date));
    return liveSignals(closed, result.best.filter((s) => s.proven));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, today.data, result, minute]);

  if (hist.isLoading) return <p className="text-[12px] text-slate-500 p-3">Testing {NAME[sym]} on 90 days…</p>;
  if (!result) return <p className="text-[12px] text-slate-500 p-3">{NAME[sym]}: not enough history to test yet.</p>;
  const proven = result.best.filter((s) => s.proven);

  return (
    <div className="space-y-2">
      {live.map((s) => (
        <div key={s.strategy} className="rounded-2xl p-3 text-white shadow-lg" style={{ background: s.side === "CE" ? "linear-gradient(135deg,#065F46,#10B981)" : "linear-gradient(135deg,#9F1239,#F43F5E)" }}>
          <p className="text-[11px] font-black uppercase tracking-wide text-white/85">🧪 Proven setup · {NAME[sym]}</p>
          <p className="text-[26px] font-black leading-tight">BUY {s.side}</p>
          <p className="text-[12.5px] font-bold">{nameOf(s.strategy)}</p>
          <p className="text-[12px] font-bold mt-1">
            Futures entry {s.entry.toFixed(2)} · stop {s.stop.toFixed(2)} · target {s.target.toFixed(2)} ({s.stats.targetR}R)
          </p>
          <p className="text-[11px] text-white/85 mt-1">
            Tested: {s.stats.hitRate}% hit, {r(s.stats.avgR)} average over {s.stats.trades} trades · worst losing run {s.stats.maxLosingStreak}
          </p>
        </div>
      ))}
      {live.length === 0 && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          {proven.length ? `No proven ${NAME[sym]} setup on the last 30-min candle. Checked every 30 minutes.` : `No strategy passed the test for ${NAME[sym]} — no trade is the honest answer.`}
        </p>
      )}
      <div className="rounded-xl border border-slate-100 overflow-hidden">
        {result.best.map((s) => (
          <div key={s.strategy} className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100 last:border-0">
            <span className={`text-[10px] font-black rounded px-1.5 py-0.5 shrink-0 ${s.proven ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{s.proven ? "PROVEN" : "FAILED"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-black text-slate-800 truncate">{nameOf(s.strategy)}</p>
              <p className="text-[10.5px] text-slate-500 truncate">
                {s.trades} trades · {s.hitRate ?? "—"}% hit · {r(s.avgR)} avg · halves {r(s.firstHalfR)} / {r(s.secondHalfR)} · {s.targetR}R target
              </p>
              {!s.proven && <p className="text-[10px] text-rose-600 truncate">{s.why}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PagesThatEarned() {
  const logs = useAppStore((s) => s.tradeLogs);
  const edges = useMemo(() => computeEngineEdges(logs).filter((e) => e.trades > 0).sort((a, b) => (b.expectancyRs ?? -1e9) - (a.expectancyRs ?? -1e9)), [logs]);
  if (!edges.length) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-2.5">
      <p className="text-[11px] font-black text-slate-700">Which of our pages actually earned (their own logged calls, 1 lot)</p>
      {edges.slice(0, 5).map((e) => (
        <div key={e.id} className="flex items-center gap-2 mt-1 text-[11px]">
          <span className="flex-1 font-bold text-slate-700 truncate">{e.label}</span>
          <span className="text-slate-500">{e.trades} · {e.winRatePct ?? "—"}% hit</span>
          <span className={`font-black ${e.netRs >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{e.netRs >= 0 ? "+" : "−"}₹{Math.abs(Math.round(e.netRs)).toLocaleString("en-IN")}</span>
        </div>
      ))}
      <Link to="/ai-edge" className="mt-1.5 text-[11px] font-black text-violet-700 flex items-center">
        Full ranking on AI Edge <ChevronRight size={13} />
      </Link>
    </div>
  );
}

/** With `symbol`, it shows that one market only (Ai-Today); without, a Crude / NG switch. */
export function StrategyLab({ symbol }: { symbol?: Sym } = {}) {
  const [picked, setSym] = useState<Sym>("CRUDEOIL");
  const sym = symbol ?? picked;
  return (
    <section className="rounded-3xl bg-white p-4 shadow-lg border border-emerald-100 space-y-3">
      <p className="text-[13.5px] font-black text-slate-900 flex items-center gap-1.5">
        <FlaskConical size={16} className="text-emerald-600" /> Proven strategies — tested on your last 90 days
      </p>
      {!symbol && (
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
        {(["CRUDEOIL", "NATURALGAS"] as const).map((s) => (
          <button key={s} onClick={() => setSym(s)} className={`rounded-xl py-1.5 text-[12px] font-black ${sym === s ? "bg-white text-slate-900 shadow" : "text-slate-500"}`}>
            {NAME[s]}
          </button>
        ))}
      </div>
      )}
      <Market key={sym} sym={sym} />
      <PagesThatEarned />
      <p className="text-[9.5px] text-slate-400 leading-snug">
        Each strategy is run over 90 days of real 30-min candles: entry at the signal close, stop/target on later candles (both in one candle = loss), never overnight, max 4 hours, cost charged. PROVEN = at least {PROVEN_RULE.minTrades} trades, {PROVEN_RULE.minHit}%+ hit, positive average, and positive in BOTH halves of the period. Past results are evidence, not a promise.
      </p>
    </section>
  );
}
