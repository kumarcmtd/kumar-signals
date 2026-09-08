import { useMemo, useState } from "react";
import { Scale, Info } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { computeEngineEdges, computeEdgeTotals, MIN_SAMPLE } from "../utils/aiEdgeEngine";
import { EdgeSummaryCard, DropTheseCard, EngineEdgeRow } from "../components/AiEdgeKit";

const PERIODS = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "3 months", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

export function AiEdge() {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const [period, setPeriod] = useState<PeriodKey>("90");
  const [showAll, setShowAll] = useState(false);

  const active = PERIODS.find((p) => p.key === period)!;
  const sinceMs = active.days === null ? null : Date.now() - active.days * 24 * 60 * 60 * 1000;

  const edges = useMemo(() => computeEngineEdges(tradeLogs, sinceMs), [tradeLogs, sinceMs]);
  const totals = useMemo(() => computeEdgeTotals(edges), [edges]);

  const traded = edges.filter((e) => e.trades > 0);
  const untouched = edges.filter((e) => e.trades === 0);
  const shown = showAll ? edges : traded;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen text-white space-y-3.5" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      <section className="pt-2">
        <div className="flex items-center gap-2">
          <Scale size={20} className="text-[#00E676]" />
          <h1 className="text-xl font-black">AI Edge</h1>
        </div>
        <p className="text-[11px] text-white/40 mt-1.5 leading-snug">
          Every engine in this app, ranked by the rupees it actually made — not by win rate. A page can win most of its trades and still lose money if its losses run bigger than its wins.
        </p>
      </section>

      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className="flex-1 rounded-xl py-2 text-[12px] font-bold border transition-colors"
            style={
              period === p.key
                ? { background: "linear-gradient(135deg,#00E676,#00B85C)", color: "#04121C", borderColor: "transparent" }
                : { background: "#14161F", borderColor: "rgba(255,255,255,.08)", color: "rgba(255,255,255,.5)" }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {totals.trades === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: "#14161F", border: "1px solid rgba(255,255,255,.07)" }}>
          <p className="text-[12.5px] font-bold text-white/70">No closed trades in this period</p>
          <p className="text-[10px] text-white/35 mt-1.5 leading-relaxed">
            AI Edge reads the trade logs your pages already keep. Once calls have opened and closed, they get scored here. Try “All time”, or give the engines a few sessions to build a record.
          </p>
        </div>
      ) : (
        <>
          <EdgeSummaryCard totals={totals} periodLabel={active.label} />
          <DropTheseCard totals={totals} />

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[13px] font-black text-white/80">Engine ranking</h2>
              <span className="text-[10px] text-white/35">by rupees earned</span>
            </div>
            <div className="space-y-2">
              {shown.map((edge, i) => (
                <EngineEdgeRow key={edge.id} edge={edge} rank={edge.trades > 0 ? i + 1 : null} />
              ))}
            </div>
            {untouched.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full mt-2.5 py-2.5 rounded-xl text-[11px] font-bold bg-white/6 text-white/60 active:scale-[.98] transition-transform"
              >
                {showAll ? "Hide engines with no trades" : `Show ${untouched.length} engines with no closed trades`}
              </button>
            )}
          </section>
        </>
      )}

      <div className="rounded-2xl p-3.5" style={{ background: "#14161F", border: "1px solid rgba(255,255,255,.07)" }}>
        <div className="flex items-center gap-1.5">
          <Info size={13} className="text-[#00C2FF]" />
          <p className="text-[11px] font-black text-white/70">What these numbers are</p>
        </div>
        <ul className="text-[10px] text-white/45 mt-2 space-y-1.5 leading-relaxed list-disc pl-4">
          <li>
            Read from <span className="text-white/70">this app's own trade logs</span> — each call recorded at its signalled entry and closed at the target or stop that was actually observed.
          </li>
          <li>
            <span className="text-white/70">Not your broker fills.</span> No brokerage, no taxes, and it assumes every call was taken at exactly 1 lot. It will not reconcile to your Upstox
            statement, and it is not meant to — it measures how good each engine is, not what you actually earned.
          </li>
          <li>
            Rupees use each symbol's own lot size (Crude 100, NG 1250), so Crude and NG are on one honest scale. Raw premium points are not comparable between them.
          </li>
          <li>
            An engine needs <span className="text-white/70">{MIN_SAMPLE} closed trades</span> before it gets any verdict. Below that it shows “too few to judge” rather than a confident rating on
            noise.
          </li>
        </ul>
      </div>

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. Past engine performance does not guarantee future results — a page that has been profitable can stop working when the market regime changes.
      </p>
    </div>
  );
}
