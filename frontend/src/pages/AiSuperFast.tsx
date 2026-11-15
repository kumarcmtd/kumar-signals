import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useMarketStatus } from "../api/hooks";
import { useTwentyV3 } from "../hooks/useTwentyV3";
import { useAppStore } from "../store/appStore";
import { useSyncStatus } from "../syncTradeLogs";
import { appVersionLabel } from "../utils/appVersion";
import { ENGINE_FAST } from "../utils/twentyV3/engines";
import { FAST_LAB } from "../utils/twentyV3/labFacts";
import { SPEED_MIN } from "../utils/twentyV3/speed";
import { VolatilityMeter } from "../components/VolatilityMeter";
import { FastTruthCard } from "../components/twentyV3/FastTruthCard";
import { TodayPlanCard } from "../components/twentyV3/TodayPlanCard";
import { V3CallCard } from "../components/twentyV3/V3CallCard";
import { MyPlanPanel } from "../components/twentyV3/MyPlanPanel";
import { SetupsBoard } from "../components/twentyV3/SetupsBoard";
import { V3Journal, type JournalRow } from "../components/twentyV3/V3Journal";
import { CallDetailModal } from "../components/twentyV3/CallDetailModal";
import type { LabSym } from "../utils/twentyLab";

// Ai-Super Fast: the trader's own rule -- calls only while price is moving
// fast (the app's Speed gauge at 70+), on a liquid strike, with the news on
// the call's side -- run on the same tested engine as Ai20-20 v3. The 10-year
// lab found Speed 70+ alone does not make money, so calls are practice until
// the live record (with the news and liquidity checks) says otherwise.

const SYMS: LabSym[] = ["CRUDEOIL", "NATURALGAS"];

export function AiSuperFast() {
  const { data: market } = useMarketStatus();
  const crude = useTwentyV3("CRUDEOIL", ENGINE_FAST);
  const gas = useTwentyV3("NATURALGAS", ENGINE_FAST);
  const board = { CRUDEOIL: crude, NATURALGAS: gas };
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const sync = useSyncStatus();
  const [detail, setDetail] = useState<JournalRow | null>(null);
  const rows = useMemo(() => SYMS.flatMap((sym) => (tradeLogs[ENGINE_FAST.key(sym)] ?? []).map((entry) => ({ sym, entry }))).sort((a, b) => b.entry.openedAt - a.entry.openedAt), [tradeLogs]);
  const i = crude.ctx ? crude.ctx.p.c.length - 1 : -1;
  const speed = i >= 0 ? crude.ctx!.f.speed[i] : NaN;

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen space-y-4" style={{ background: "linear-gradient(180deg,#FFF7ED,#EFF6FF 40%,#F8FAFC)" }}>
      <section className="text-center pt-2 space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <Zap size={24} className="text-orange-500" />
          <h1 className="text-2xl font-black bg-gradient-to-r from-orange-500 via-rose-500 to-violet-500 bg-clip-text text-transparent">Ai-Super Fast</h1>
          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 text-white">{`Speed ${SPEED_MIN}+ only`}</span>
        </div>
        <p className="text-[11.5px] text-slate-600 px-3 leading-snug">Calls only when crude is moving fast, the option trades well and the news is on the call's side — sized to your plan, guided step by step, alerts even with the app closed.</p>
        <p className="text-[10px] text-slate-400 flex items-center justify-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${market?.isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
          {market ? (market.isOpen ? "MCX open" : "MCX closed") : "…"}
        </p>
      </section>

      {(sync.pull === "failed" || sync.push === "failed") && (
        <section className="rounded-2xl px-3 py-2.5 bg-amber-50 border border-amber-300">
          <p className="text-[12px] font-black text-amber-900">⚠️ This phone's call record is not syncing with the server</p>
          {sync.error && <p className="text-[11px] text-amber-900 leading-snug mt-0.5">{sync.error}</p>}
          {sync.error && /access key/i.test(sync.error) && (
            <Link to="/settings" className="text-[10.5px] font-black underline text-amber-800">
              Open Settings
            </Link>
          )}
        </section>
      )}

      <FastTruthCard />

      <section className="space-y-1.5">
        <VolatilityMeter symbol="CRUDEOIL" />
        <p className="text-[10.5px] text-slate-500 px-1 leading-snug">
          {Number.isFinite(speed)
            ? `Calls use finished 15-minute candles: Speed ${speed} now — ${speed >= SPEED_MIN ? "fast enough ✓" : `needs ${SPEED_MIN}+`}.`
            : "Calls use finished 15-minute candles; Speed appears once enough candles are loaded."}{" "}
          {`It read ${SPEED_MIN}+ on about ${FAST_LAB.speed70Share}% of candles over the last five years.`}
        </p>
      </section>

      <TodayPlanCard s={crude} />
      <V3CallCard s={crude} />
      <V3CallCard s={gas} />
      <MyPlanPanel />
      <SetupsBoard crude={crude} gas={gas} facts={FAST_LAB} />
      <V3Journal rows={rows} lots={Math.max(1, crude.lots.lots)} onOpen={setDetail} name="Super Fast" />

      <p className="text-[10px] text-slate-400 leading-relaxed text-center px-4 pb-2">
        Educational reference, not financial advice. Practice calls are paper trades. Test results are on past prices with costs taken off — real fills, spreads and fast markets differ. Never risk money you cannot afford to lose.
      </p>
      <p className="text-[10px] text-slate-400 text-center -mt-2">App version: {appVersionLabel()}</p>

      {detail && <CallDetailModal symbol={detail.sym} entry={detail.entry} candles={board[detail.sym].candles} candlesLoading={board[detail.sym].loading} onClose={() => setDetail(null)} />}
    </div>
  );
}
