import { useMemo, useState } from "react";
import { Target, ChevronDown, BookOpen, NotebookPen } from "lucide-react";
import { Link } from "react-router-dom";
import { useMarketStatus } from "../api/hooks";
import { useTwentyV3 } from "../hooks/useTwentyV3";
import { useAppStore } from "../store/appStore";
import { useSyncStatus } from "../syncTradeLogs";
import { appVersionLabel } from "../utils/appVersion";
import { ENGINE_DAY, ENGINE_SEASON, ENGINE_V3, type EngineDef } from "../utils/twentyV3/engines";
import { callWindow, istClock } from "../utils/twentyV3/dayPlan";
import { DAY_LAB, SMART_LAB } from "../utils/twentyV3/labFacts";
import { ExpiryAlertBanner } from "../components/ExpiryAlertBanner";
import { ResultsStrip } from "../components/aiTest/ResultsStrip";
import { TodayPlanCard } from "../components/twentyV3/TodayPlanCard";
import { SeasonCard } from "../components/twentyV3/SeasonCard";
import { LevelsCard } from "../components/twentyV3/LevelsCard";
import { SmartRulesCard } from "../components/twentyV3/SmartRulesCard";
import { V3CallCard } from "../components/twentyV3/V3CallCard";
import { MyPlanPanel } from "../components/twentyV3/MyPlanPanel";
import { SetupsBoard } from "../components/twentyV3/SetupsBoard";
import { V3Journal, type JournalRow } from "../components/twentyV3/V3Journal";
import { CallDetailModal } from "../components/twentyV3/CallDetailModal";
import type { LabSym } from "../utils/twentyLab";

// Ai20-20: the v2 calls the trader earned from, back as LIVE calls -- with the
// trader's own "careful at the high" rule and a season switch that rests the
// line while its recent record is bad. Strict where it protects money, free
// where extra rules only spoiled good catches. The older practice lines sit
// folded at the bottom.

const SYMS: LabSym[] = ["CRUDEOIL", "NATURALGAS"];
const signed = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;

function Fold({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl bg-white/70 shadow-sm border border-white overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left" aria-expanded={open}>
        <NotebookPen size={18} className="text-violet-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black text-slate-800">{title}</p>
          <p className="text-[11px] text-slate-500">{sub}</p>
        </div>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </section>
  );
}

function HowBuilt() {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-3xl bg-white shadow-md overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 flex items-center gap-3 text-left">
        <BookOpen size={18} className="text-sky-500 shrink-0" />
        <p className="flex-1 text-[13px] font-black text-slate-800">How it was tested</p>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 text-[11px] text-slate-600 leading-snug">
          <p>
            <b>The main line ({SMART_LAB.ranAt}).</b> Every rule was replayed on 5-minute crude prices from 2017 to 2026 with the live page's trade management, costs (spread, charges, time decay) taken off every call. Choices were made on 2022–26 and then checked on 2017–21. The v2 calls alone: {signed(SMART_LAB.v2Always.avgRs)} a call over ten years. With your “careful at the high” rule and the season switch: {signed(SMART_LAB.tenYears.avgRs)} a call ({SMART_LAB.tenYears.calls} calls) — {signed(SMART_LAB.line.recent.avgRs)} in 2022–26 but still {signed(SMART_LAB.line.holdout.avgRs)} in 2017–21. By year: {SMART_LAB.lineByYear.map(([y, r]) => `${y} ${signed(r)}`).join(" · ")}.
          </p>
          <p>
            <b>Your run-to-the-high idea</b> was tested as its own calls in {SMART_LAB.gapRun.versions + SMART_LAB.gapBreak.versions} versions (lookback, room, speed, trend, time window, and the 5-minute close above the high). Every one lost money in both periods — the recent high stops most runs. So the calls use its careful part only.
          </p>
          <p>
            <b>Practice lines.</b> The big opening drive and the all-day line keep running as practice: on ten years of prices the all-day signal lost in every year (about ₹{Math.abs(DAY_LAB.crude.trendDay.recent.avgRs)} a call after costs).
          </p>
          <p>Past results never guarantee future ones; markets change. Judge the line by its own live record above.</p>
        </div>
      )}
    </section>
  );
}

export function AiTwentyTwenty() {
  const { data: market } = useMarketStatus();
  const season = useTwentyV3("CRUDEOIL", ENGINE_SEASON);
  const seasonGas = useTwentyV3("NATURALGAS", ENGINE_SEASON);
  const crude = useTwentyV3("CRUDEOIL");
  const crudeDay = useTwentyV3("CRUDEOIL", ENGINE_DAY);
  const gas = useTwentyV3("NATURALGAS");
  const board = { CRUDEOIL: season, NATURALGAS: seasonGas };
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const sync = useSyncStatus();
  const [detail, setDetail] = useState<JournalRow | null>(null);

  const rowsOf = (def: EngineDef) => SYMS.flatMap((sym) => (tradeLogs[def.key(sym)] ?? []).map((entry) => ({ sym, entry }))).sort((a, b) => b.entry.openedAt - a.entry.openedAt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mainRows = useMemo(() => rowsOf(ENGINE_SEASON), [tradeLogs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const driveRows = useMemo(() => rowsOf(ENGINE_V3), [tradeLogs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dayRows = useMemo(() => rowsOf(ENGINE_DAY), [tradeLogs]);
  // The results strip counts the main line's real calls only (practice calls are paper).
  const liveLogs = useMemo(() => Object.fromEntries(SYMS.map((sym) => [ENGINE_SEASON.key(sym), (tradeLogs[ENGINE_SEASON.key(sym)] ?? []).filter((e) => !e.practice)])), [tradeLogs]);

  const w = callWindow(ENGINE_SEASON.active.CRUDEOIL);
  // "9:05–11:30" + "PM": the window fits its tile.
  const hm = (ms: number) => istClock(ms).replace(/ (AM|PM)$/, "");
  const ap = (ms: number) => istClock(ms).slice(-2);
  const win = w ? { big: `${hm(w.from)}–${hm(w.bell ?? w.to)}`, small: `${ap(w.from) === ap(w.bell ?? w.to) ? ap(w.from) : `${ap(w.from)}–${ap(w.bell ?? w.to)}`} IST · calls` } : { big: "—", small: "call time" };
  const seasonWord = season.resting === null ? "…" : season.resting ? "RESTING" : "LIVE";
  const open = market?.isOpen === true;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-3.5 text-slate-800" style={{ background: "linear-gradient(180deg,#F5F3FF 0%,#FDF2F8 35%,#FFF7ED 70%,#F8FAFC 100%)" }}>
      <section className="relative overflow-hidden rounded-3xl p-4 text-white shadow-lg shadow-fuchsia-300/40" style={{ background: "linear-gradient(135deg,#7C3AED 0%,#DB2777 55%,#F97316 100%)" }}>
        <span className="pointer-events-none absolute -top-10 -right-8 w-36 h-36 rounded-full bg-white/20 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-12 -left-10 w-40 h-40 rounded-full bg-amber-300/30 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/20 ring-1 ring-white/40 shrink-0">
            <Target size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[24px] font-black leading-tight drop-shadow-sm">Ai20-20</h1>
            <p className="text-[11.5px] text-white/90 leading-snug">The v2 calls are back · with your “careful at the high” rule</p>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-center">
          {[
            [seasonWord, "season"],
            [win.big, win.small],
            [signed(SMART_LAB.tenYears.avgRs), "a call · 10 yrs"],
          ].map(([big, small]) => (
            <div key={small} className="rounded-2xl bg-white/20 ring-1 ring-white/30 py-1.5 px-1">
              <p className="text-[15px] font-black leading-none truncate">{big}</p>
              <p className="text-[9.5px] font-bold uppercase text-white/90 mt-1">{small}</p>
            </div>
          ))}
        </div>
        <p className="relative mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black bg-white/20 ring-1 ring-white/30">
          <span className={`w-2 h-2 rounded-full ${open ? "bg-lime-300 animate-pulse" : "bg-rose-200"}`} />
          {market ? (open ? "MCX open · alerts on even with the app closed" : "MCX closed") : "…"}
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

      <ResultsStrip logs={liveLogs} engineId="twenty20" signalsTab={false} />
      <SeasonCard s={season} />
      <TodayPlanCard s={season} />
      <ExpiryAlertBanner />
      <V3CallCard s={season} />
      <LevelsCard s={season} />
      <SmartRulesCard />
      <MyPlanPanel />
      <V3Journal rows={mainRows} lots={Math.max(1, season.lots.lots)} onOpen={setDetail} name="Ai20-20" />

      <Fold title="Practice lines & gas" sub="Opening drive and all-day practice calls (paper only) · gas">
        <V3CallCard s={crudeDay} />
        <V3CallCard s={crude} />
        <V3CallCard s={gas} />
        <V3Journal rows={dayRows} lots={Math.max(1, crude.lots.lots)} onOpen={setDetail} name="all-day" />
        <V3Journal rows={driveRows} lots={Math.max(1, crude.lots.lots)} onOpen={setDetail} name="opening-drive" />
        <SetupsBoard crude={crude} gas={gas} also={crudeDay} />
      </Fold>
      <HowBuilt />

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference, not financial advice. Test results are on past prices with costs taken off — real fills, spreads and fast markets differ, and no rule wins every day. Never risk money you cannot afford to lose.
      </p>
      <p className="text-[10px] text-slate-400 text-center -mt-2">App version: {appVersionLabel()}</p>

      {detail && <CallDetailModal symbol={detail.sym} entry={detail.entry} candles={board[detail.sym].candles} candlesLoading={board[detail.sym].loading} onClose={() => setDetail(null)} />}
    </div>
  );
}
