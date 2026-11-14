import { useMemo, useState } from "react";
import { Target, ChevronDown, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useMarketStatus } from "../api/hooks";
import { useTwentyV3 } from "../hooks/useTwentyV3";
import { useAppStore } from "../store/appStore";
import { useSyncStatus } from "../syncTradeLogs";
import { appVersionLabel } from "../utils/appVersion";
import { v3Key } from "../utils/twentyV3/live";
import { ExpiryAlertBanner } from "../components/ExpiryAlertBanner";
import { TodayPlanCard } from "../components/twentyV3/TodayPlanCard";
import { TruthCard } from "../components/twentyV3/TruthCard";
import { V3CallCard } from "../components/twentyV3/V3CallCard";
import { MyPlanPanel } from "../components/twentyV3/MyPlanPanel";
import { SetupsBoard } from "../components/twentyV3/SetupsBoard";
import { V3Journal, type JournalRow } from "../components/twentyV3/V3Journal";
import { CallDetailModal } from "../components/twentyV3/CallDetailModal";
import type { LabSym } from "../utils/twentyLab";

// Ai20-20 v3 -- run the way a disciplined trade manager runs money: the plan
// and the risk first, only setups that proved themselves on years of real
// prices get to trade, one exact instruction per call, and every step of a
// running call watched (and pushed to the phone) until it closes.

const SYMS: LabSym[] = ["CRUDEOIL", "NATURALGAS"];

function HowBuilt() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left">
        <BookOpen size={18} className="text-sky-500 shrink-0" />
        <p className="flex-1 text-[13px] font-black text-slate-800">How v3 was built — the research</p>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 text-[11px] text-slate-600 leading-snug">
          <p>
            <b>Strategies.</b> The noise-band breakout with a VWAP trailing exit comes from Zarattini, Aziz & Barbon, <i>Beat the Market: An Effective Intraday Momentum Strategy</i> (Swiss Finance Institute, 2024). The opening-drive idea comes from crude-oil research finding the first half hour of the US session predicts later returns (Wen, Indriawan, Lien & Xu, <i>Economic Modelling</i>). Opening-range breakouts were tested because they are popular — recent cost-inclusive studies find most do not survive trading costs.
          </p>
          <p>
            <b>EIA Wednesdays.</b> Studies of WTI around the 10:30 AM report find big jumps at release and a partial reversal in the hours after, so both following and fading the move were tested.
          </p>
          <p>
            <b>Strike.</b> At the money or slightly in the money (delta about 0.5–0.65): far out-of-the-money options barely move and decay fast; near expiry one strike in the money loses less to time decay.
          </p>
          <p>
            <b>Money rules.</b> Risk about 1% of capital a trade, stop for the day at about 3% lost, keep the number of trades small — the common professional rules, so one bad week cannot break the account.
          </p>
          <p>
            <b>The test.</b> Every setup was replayed on 5-minute crude prices from 2017 to 2026 (gas 2022–26) with the same trade management as the live page, costs (spread, charges, time decay) taken off every call. Rules were chosen on 2022–26 and then checked on 2017–21, years never used to choose. Only a setup that passes both may trade real money — none did, so v3 starts with practice calls. Past results never guarantee future ones.
          </p>
        </div>
      )}
    </section>
  );
}

export function AiTwentyTwenty() {
  const { data: market } = useMarketStatus();
  const crude = useTwentyV3("CRUDEOIL");
  const gas = useTwentyV3("NATURALGAS");
  const board = { CRUDEOIL: crude, NATURALGAS: gas };
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const sync = useSyncStatus();
  const [detail, setDetail] = useState<JournalRow | null>(null);

  const rows = useMemo(() => SYMS.flatMap((sym) => (tradeLogs[v3Key(sym)] ?? []).map((entry) => ({ sym, entry }))).sort((a, b) => b.entry.openedAt - a.entry.openedAt), [tradeLogs]);

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#ECFDF5,#F0F9FF 40%,#F8FAFC)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <Target size={24} className="text-emerald-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-500 bg-clip-text text-transparent">Ai20-20</h1>
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-600 to-sky-600 text-white">v3 · trade manager</span>
        </div>
        <p className="text-[11.5px] text-slate-600 px-3 leading-snug">
          Your money rules first, the truth about every strategy, and calls that say exactly what to buy, how many lots and when to get out — guided step by step, with alerts even when the app is closed.
        </p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "MCX open" : "MCX closed") : "…"}
        </p>
      </section>

      {(sync.pull === "failed" || sync.push === "failed") && (
        <section className="rounded-2xl px-3 py-2.5 bg-amber-50 border border-amber-300">
          <p className="text-[12px] font-black text-amber-900">⚠️ This phone's call record is not syncing with the server</p>
          {sync.error && <p className="text-[11px] text-amber-900 leading-snug mt-0.5">{sync.error}</p>}
          <p className="text-[10.5px] text-amber-800 leading-snug mt-1">
            Calls the server records while the app is closed will not show here until it syncs.{" "}
            {sync.error && /access key/i.test(sync.error) && (
              <Link to="/settings" className="font-black underline">
                Open Settings
              </Link>
            )}
          </p>
        </section>
      )}

      <TruthCard />
      <TodayPlanCard s={crude} />
      <ExpiryAlertBanner />
      <V3CallCard s={crude} />
      <V3CallCard s={gas} />
      <MyPlanPanel />
      <SetupsBoard crude={crude} gas={gas} />
      <V3Journal rows={rows} lots={Math.max(1, crude.lots.lots)} onOpen={setDetail} />
      <HowBuilt />

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference, not financial advice. Test results are on past prices with costs taken off — real fills, spreads and fast markets differ, and no setup wins every day. Never risk money you cannot afford to lose.
      </p>
      <p className="text-[10px] text-slate-400 text-center -mt-2">App version: {appVersionLabel()}</p>

      {detail && <CallDetailModal symbol={detail.sym} entry={detail.entry} candles={board[detail.sym].candles} candlesLoading={board[detail.sym].loading} onClose={() => setDetail(null)} />}
    </div>
  );
}
