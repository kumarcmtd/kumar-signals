import { useMemo, useState } from "react";
import { Brain, AlertTriangle, Radio } from "lucide-react";
import { useMarketStatus, usePortfolio, useCreateTrade } from "../api/hooks";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { useTimeframeSuite, TIMEFRAMES } from "../hooks/useTimeframeSuite";
import { useTradeLog, liveLtpFor } from "../hooks/useTradeLog";
import { computePortfolioSummary } from "../utils/portfolioStats";
import { nextMcxOpen } from "../utils/mcxSession";
import type { TimeframeAnalysis } from "../utils/timeframeEngine";
import { AiTestHero } from "../components/aiTest/AiTestHero";
import { ResultsStrip } from "../components/aiTest/ResultsStrip";
import { ConfluenceMap } from "../components/aiTest/ConfluenceMap";
import { CallRow, LiveCallCard } from "../components/aiTest/LiveCallCard";
import { TfDetail } from "../components/aiTest/TfDetail";
import { TradeLogDetailModal } from "../components/aiTest/TradeLogKit";
import { copyTip, DISPLAY_NAME, LOT_SIZE, MARGINAL, ownLogs, projectPremium, SYMBOLS, TF_SHORT, type TradableSymbol } from "../components/aiTest/kit";

// AI-Test V2: four timeframes scored independently for Crude and Natural Gas,
// a call line per timeframe opened and tracked by the page. Laid out for a
// phone: results first (folded), what is running now, one map of both
// markets x four timeframes, and the full read for whichever cell is tapped.

type Sel = { sym: TradableSymbol; tf: string };
const SEL_KEY = "aitest.sel";
const readSel = (): Sel | null => {
  try {
    const v = JSON.parse(localStorage.getItem(SEL_KEY) ?? "null");
    return v && SYMBOLS.includes(v.sym) && TIMEFRAMES.some((t) => t.tf === v.tf) ? v : null;
  } catch {
    return null;
  }
};

function summary(sym: TradableSymbol, analyses: TimeframeAnalysis[]): string {
  const valid = analyses.filter((a) => a.overallScore !== null);
  if (!valid.length) return `Not enough live data yet to read ${DISPLAY_NAME[sym]}.`;
  const act = valid.filter((a) => a.decision !== "WAIT");
  if (!act.length) return `${DISPLAY_NAME[sym]}: no timeframe has a high-probability setup right now — signals are mixed or held back by the rules. Wait for alignment.`;
  const up = valid.filter((a) => a.bias === "bullish").length;
  const dn = valid.filter((a) => a.bias === "bearish").length;
  return `${DISPLAY_NAME[sym]}: ${up > dn ? "bullish" : dn > up ? "bearish" : "mixed"} on ${act.map((a) => TF_SHORT[a.tf] ?? a.label).join(", ")}. It holds while that lasts — confirm on the live chart before acting.`;
}

export function AITest() {
  const { data: market } = useMarketStatus();
  const { data: trades } = usePortfolio();
  const { risk } = useAppStore();
  const createTrade = useCreateTrade();
  const [loggedIds, setLoggedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ sym: TradableSymbol; e: TradeLogEntry } | null>(null);
  const [pick, setPick] = useState<Sel | null>(readSel);
  // Which running call is opened up (the newest one until the trader taps another).
  const [openId, setOpenId] = useState<string | null>(null);

  // An error answer from the journal API must not take the page down.
  const journalWinRate = useMemo(() => computePortfolioSummary(Array.isArray(trades) ? trades : []).winRate, [trades]);
  const crude = useTimeframeSuite("CRUDEOIL", journalWinRate);
  const gas = useTimeframeSuite("NATURALGAS", journalWinRate);
  const board: Record<TradableSymbol, ReturnType<typeof useTimeframeSuite>> = { CRUDEOIL: crude, NATURALGAS: gas };

  // Both markets are ticked every render, whichever cell is open -- otherwise
  // the other market's calls would stop advancing while you look elsewhere.
  // New calls open only while MCX is open: a closed market's option prices are
  // the last session's, so an "entry" then could never be bought. Calls
  // already running keep being tracked either way.
  const tradable = market?.isOpen === true;
  const crudeProj = useMemo(() => crude.analyses.map((a) => (tradable ? projectPremium(a, crude.options) : null)), [crude.analyses, crude.options, tradable]);
  const gasProj = useMemo(() => gas.analyses.map((a) => (tradable ? projectPremium(a, gas.options) : null)), [gas.analyses, gas.options, tradable]);
  useTradeLog("CRUDEOIL", crude.analyses, crudeProj, crude.options);
  const tradeLogs = useTradeLog("NATURALGAS", gas.analyses, gasProj, gas.options);
  const own = useMemo(() => ownLogs(tradeLogs), [tradeLogs]);
  const liveFor = (sym: TradableSymbol, e: TradeLogEntry) => liveLtpFor(board[sym].options, e.strike, e.optSide);

  const running = useMemo(
    () =>
      SYMBOLS.flatMap((sym) =>
        TIMEFRAMES.flatMap(({ tf }) => {
          const log = own[`${sym}-${tf}`] ?? [];
          const last = log[log.length - 1];
          return last && !last.closed ? [{ sym, tf, e: last }] : [];
        })
      ).sort((a, b) => b.e.openedAt - a.e.openedAt),
    [own]
  );
  // The strongest live read: a full-strength tier first, then the highest hit probability.
  const star = useMemo(() => {
    const act = SYMBOLS.flatMap((sym) => board[sym].analyses.filter((a) => a.decision !== "WAIT" && a.hitProbability !== null).map((a) => ({ sym, a })));
    const strong = act.filter((x) => !MARGINAL.has(x.a.decision));
    const pool = strong.length ? strong : act;
    return pool.length ? pool.reduce((b, x) => ((x.a.hitProbability ?? 0) > (b.a.hitProbability ?? 0) ? x : b)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crude.analyses, gas.analyses]);
  const sel: Sel = pick ?? (running[0] ? { sym: running[0].sym, tf: running[0].tf } : star ? { sym: star.sym, tf: star.a.tf } : { sym: "NATURALGAS", tf: "60" });
  const choose = (sym: TradableSymbol, tf: string) => {
    setPick({ sym, tf });
    try {
      localStorage.setItem(SEL_KEY, JSON.stringify({ sym, tf }));
    } catch {
      /* private mode */
    }
  };
  const selA = board[sel.sym].analyses.find((a) => a.tf === sel.tf) ?? board[sel.sym].analyses[0];
  const selLog = own[`${sel.sym}-${sel.tf}`] ?? [];
  const selRun = running.find((r) => r.sym === sel.sym && r.tf === sel.tf) ?? null;
  const updatedAt = Math.max(crude.dataUpdatedAt, gas.dataUpdatedAt);
  const isOpen = market ? market.isOpen : null;

  const card = (r: { sym: TradableSymbol; tf: string; e: TradeLogEntry }, open?: () => void) => (
    <LiveCallCard
      key={r.e.id}
      sym={r.sym}
      tf={r.tf}
      e={r.e}
      live={liveFor(r.sym, r.e)}
      logged={loggedIds.includes(r.e.id)}
      copied={copiedId === r.e.id}
      onOpen={open}
      onCopy={() => {
        copyTip(r.sym, r.e, board[r.sym].signal?.expiry);
        setCopiedId(r.e.id);
        setTimeout(() => setCopiedId(null), 2000);
      }}
      onLog={() =>
        createTrade.mutate(
          { symbol: r.sym, optSide: r.e.optSide, strike: r.e.strike, entryPrice: r.e.entry, stopLoss: r.e.stop, target: r.e.targets[0], quantity: 1, lotSize: LOT_SIZE[r.sym], source: "master-ai", notes: `Logged from AI-Test (${TF_SHORT[r.tf] ?? r.tf})` },
          { onSuccess: () => setLoggedIds((ids) => [...ids, r.e.id]) }
        )
      }
    />
  );

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 text-slate-800 min-h-screen space-y-3.5" style={{ background: "linear-gradient(180deg,#F5F3FF 0%,#FDF2F8 30%,#ECFEFF 65%,#F8FAFC 100%)" }}>
      <AiTestHero open={isOpen} timeLabel={market?.timeLabel} updatedAt={updatedAt} fetching={crude.isFetching || gas.isFetching} onRefresh={() => void Promise.all([crude.refetchAll(), gas.refetchAll()])} />
      <ResultsStrip logs={own} />

      <section className="space-y-2">
        <p className="text-[14px] font-black flex items-center gap-2 px-1 text-slate-800">
          <span className="w-7 h-7 rounded-xl flex items-center justify-center shadow-sm" style={{ background: running.length ? "linear-gradient(135deg,#F97316,#DB2777)" : "linear-gradient(135deg,#94A3B8,#CBD5E1)" }}>
            <Radio size={15} className="text-white" />
          </span>
          {running.length ? `Running now · ${running.length}` : "Running now"}
        </p>
        {running.length ? (
          running.map((r) =>
            (openId ?? running[0].e.id) === r.e.id ? (
              card(r, () => choose(r.sym, r.tf))
            ) : (
              <CallRow
                key={r.e.id}
                sym={r.sym}
                tf={r.tf}
                e={r.e}
                live={liveFor(r.sym, r.e)}
                onTap={() => {
                  setOpenId(r.e.id);
                  choose(r.sym, r.tf);
                }}
              />
            )
          )
        ) : (
          <p className="rounded-2xl bg-white shadow-sm px-3 py-2.5 text-[12px] text-slate-600 leading-snug">
            {isOpen === false ? `MCX is closed — calls close at the bell and no new call opens until the next session, ${nextMcxOpen().label}.` : "No call running. A call opens the moment a timeframe's signal turns — the map shows how close each one is."}
          </p>
        )}
      </section>

      <ConfluenceMap rows={SYMBOLS.map((sym) => ({ sym, analyses: board[sym].analyses, logs: own }))} sel={sel} onSelect={choose} stale={isOpen === false} star={star ? `${star.sym}-${star.a.tf}` : null} />

      <p className="flex items-start gap-2.5 rounded-2xl bg-white shadow-sm px-3 py-2.5 text-[12px] text-slate-700 leading-snug">
        <span className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#8B5CF6,#EC4899)" }}>
          <Brain size={15} className="text-white" />
        </span>
        {summary(sel.sym, board[sel.sym].analyses)}
      </p>

      {board[sel.sym].liveDataUnavailable && (
        <p className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-300 px-3 py-2.5 text-[12px] font-semibold text-amber-900 leading-snug">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {`${board[sel.sym].errorMessage ?? "Option chain unreachable"} — no entry, target, stop or probability is made up while live data is down.`}
        </p>
      )}

      {selA && (
        <TfDetail
          sym={sel.sym}
          a={selA}
          log={selLog}
          liveFor={(e) => liveFor(sel.sym, e)}
          onOpenEntry={(e) => setDetail({ sym: sel.sym, e })}
          running={
            selRun ? (
              <p className="rounded-xl bg-orange-50 border border-orange-200 px-2.5 py-2 text-[12px] font-semibold text-orange-800">{`Call running on this timeframe: ${selRun.e.strike} ${selRun.e.optSide} from ₹${selRun.e.entry}${liveFor(sel.sym, selRun.e) !== null ? ` · now ₹${liveFor(sel.sym, selRun.e)}` : ""} — its card is under Running now.`}</p>
            ) : null
          }
        />
      )}

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        {`Educational reference only, not financial advice. Position sizing uses your Risk page settings (₹${risk.capital.toLocaleString("en-IN")} capital, ${risk.riskPercent}% risk). Every timeframe is scored on its own — nothing here is a guaranteed outcome.`}
      </p>

      {detail && <TradeLogDetailModal symbol={detail.sym} entry={detail.e} onClose={() => setDetail(null)} />}
    </div>
  );
}
