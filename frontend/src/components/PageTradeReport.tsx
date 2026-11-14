// "Trade report" for the page you are on: only THIS page's own calls, in
// rupees per lot. Rendered once by the app shell under every page that makes
// calls (the ENGINES registry says which log belongs to which page), so each
// page carries its own report without each page file having to add one.

import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { NotebookText, ChevronDown } from "lucide-react";
import { useAppStore, type TradeLogEntry } from "../store/appStore";
import { useTradeCardLog } from "../api/hooks";
import { toLogEntry } from "./trust/TrustLiveCalls";
import { ENGINES, type EngineDef } from "../utils/aiEdgeEngine";
import { buildPageReport, EST_COST_RS, type ReportMarket, type ReportPeriod, type ReportRow } from "../utils/pageReport";

const PERIODS: { k: ReportPeriod; t: string }[] = [
  { k: "today", t: "Today" },
  { k: "7d", t: "7 days" },
  { k: "30d", t: "30 days" },
  { k: "all", t: "All" },
];
const MARKETS: { k: ReportMarket; t: string }[] = [
  { k: "ALL", t: "Both" },
  { k: "CRUDEOIL", t: "🛢️ Crude" },
  { k: "NATURALGAS", t: "🔥 NG" },
];
/**
 * Pages whose report counts only some of their keys. Ai20-20 started fresh
 * with v2: the old rules' calls stay saved but are not mixed into its report.
 */
const ROUTE_KEYS: Record<string, { only: (key: string) => boolean; label: string }> = {
  "/ai-20-20": { only: (k) => k.endsWith("-V3"), label: "Ai20-20 v3" },
};
/** Pages that share another page's log (AI-Test Pro writes AI-Test's keys). */
const ROUTE_ALIAS: Record<string, string> = { "/ai-test-pro": "/ai-test-v2" };
const PREF = "pageReport.period";

const rs = (n: number) => `${n >= 0 ? "+" : "−"}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const when = (ms: number) => new Date(ms).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function readPeriod(): ReportPeriod {
  try {
    const v = localStorage.getItem(PREF);
    return v === "today" || v === "7d" || v === "all" ? v : "30d";
  } catch {
    return "30d";
  }
}

function Tile({ big, small, bg }: { big: string; small: string; bg: string }) {
  return (
    <div className="rounded-2xl p-2 text-center text-white" style={{ background: bg }}>
      <p className="text-[15px] font-black leading-tight">{big}</p>
      <p className="text-[9.5px] font-bold uppercase opacity-90">{small}</p>
    </div>
  );
}

function Table({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase text-slate-400 mb-1">{title}</p>
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-slate-400 text-left">
            <th className="font-semibold pb-1"> </th>
            <th className="font-semibold pb-1">Calls</th>
            <th className="font-semibold pb-1">Won / Stop</th>
            <th className="font-semibold pb-1">Win %</th>
            <th className="font-semibold pb-1 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-100">
              <td className="py-1.5 font-bold text-slate-700">{r.label}</td>
              <td className="py-1.5 text-slate-600">{r.closed}</td>
              <td className="py-1.5">
                <span className="font-bold text-emerald-600">{r.won}</span> / <span className="font-bold text-rose-500">{r.stopped}</span>
              </td>
              <td className="py-1.5 text-slate-600">{r.winPct ?? "—"}%</td>
              <td className="py-1.5 text-right font-black" style={{ color: r.netRs >= 0 ? "#059669" : "#E11D48" }}>
                {rs(r.netRs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageTradeReport({ engine, logs, note, keyFilter }: { engine: EngineDef; logs?: Record<string, TradeLogEntry[]>; note?: string; keyFilter?: (key: string) => boolean }) {
  const storeLogs = useAppStore((s) => s.tradeLogs);
  const tradeLogs = useMemo(() => {
    const base = logs ?? storeLogs;
    if (!keyFilter) return base;
    return Object.fromEntries(Object.entries(base).filter(([k]) => keyFilter(k)));
  }, [logs, storeLogs, keyFilter]);
  const [period, setPeriodState] = useState<ReportPeriod>(readPeriod);
  const [market, setMarket] = useState<ReportMarket>("ALL");
  const [open, setOpen] = useState(false);
  const setPeriod = (p: ReportPeriod) => {
    setPeriodState(p);
    try {
      localStorage.setItem(PREF, p);
    } catch {
      /* private mode */
    }
  };
  const r = useMemo(() => buildPageReport(tradeLogs, engine, { period, market, scoped: logs !== undefined }), [tradeLogs, engine, period, market, logs]);
  const chip = (on: boolean) => `rounded-lg px-2 py-1 text-[11px] font-black ${on ? "bg-white text-indigo-700" : "bg-white/15 text-white/85"}`;

  return (
    <section className="mt-5 rounded-3xl p-3 shadow-lg space-y-2.5" style={{ background: "linear-gradient(135deg,#312E81,#4F46E5 55%,#7C3AED)" }}>
      <div className="flex items-center gap-2 px-1">
        <NotebookText size={17} className="text-indigo-100" />
        <div className="flex-1">
          <p className="text-[14px] font-black text-white leading-tight">{engine.label} — trade report</p>
          <p className="text-[10.5px] text-indigo-100">Only this page's calls · 1 lot each · costs taken off</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-1">
        {PERIODS.map((p) => (
          <button key={p.k} onClick={() => setPeriod(p.k)} className={chip(period === p.k)}>
            {p.t}
          </button>
        ))}
        <span className="w-2" />
        {MARKETS.map((m) => (
          <button key={m.k} onClick={() => setMarket(m.k)} className={chip(market === m.k)}>
            {m.t}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white/95 p-3 space-y-2.5">
        {r.closed === 0 ? (
          <p className="text-[12px] text-slate-500 text-center py-2">
            No closed calls in this period{r.running ? ` · ${r.running} running now` : ""}. Each call is added here when it closes.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Tile big={String(r.closed)} small="calls closed" bg="linear-gradient(135deg,#0EA5E9,#06B6D4)" />
              <Tile big={r.winPct === null ? "—" : `${r.winPct}%`} small={`win · ${r.won}W ${r.stopped}L`} bg="linear-gradient(135deg,#10B981,#059669)" />
              <Tile big={r.t1Pct === null ? "—" : `${r.t1Pct}%`} small="reached T1" bg="linear-gradient(135deg,#6366F1,#8B5CF6)" />
              <Tile big={rs(r.netRs)} small="net / lot" bg={r.netRs >= 0 ? "linear-gradient(135deg,#059669,#10B981)" : "linear-gradient(135deg,#BE123C,#F43F5E)"} />
              <Tile big={r.avgNetRs === null ? "—" : rs(r.avgNetRs)} small="per call" bg={(r.avgNetRs ?? 0) >= 0 ? "linear-gradient(135deg,#0D9488,#14B8A6)" : "linear-gradient(135deg,#E11D48,#FB7185)"} />
              <Tile big={String(r.running)} small="running now" bg="linear-gradient(135deg,#F59E0B,#F97316)" />
            </div>
            {r.other > 0 && <p className="text-[10.5px] text-slate-500">{r.other} more closed at cost, at the day's end or by hand — counted in the money, not in win %.</p>}
            {r.streak && r.streak.n >= 3 && (
              <p className={`text-[11.5px] font-black rounded-xl px-2.5 py-1.5 ${r.streak.kind === "stopped" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                {r.streak.kind === "stopped" ? `⚠️ ${r.streak.n} stop-losses in a row — slow down: half size or skip the next call.` : `🔥 ${r.streak.n} wins in a row — keep the same size; don't get greedy.`}
              </p>
            )}
            <div className="space-y-1 text-[11px]">
              {r.best && (
                <p className="text-slate-600">
                  <span className="font-black text-emerald-700">Best:</span> {r.best.symbol === "CRUDEOIL" ? "Crude" : "NG"} {r.best.entry.strike} {r.best.entry.optSide} ({r.best.group}) {rs(r.best.rs)} · {when(r.best.closedAt)}
                </p>
              )}
              {r.worst && (
                <p className="text-slate-600">
                  <span className="font-black text-rose-600">Worst:</span> {r.worst.symbol === "CRUDEOIL" ? "Crude" : "NG"} {r.worst.entry.strike} {r.worst.entry.optSide} ({r.worst.group}) {rs(r.worst.rs)} · {when(r.worst.closedAt)}
                </p>
              )}
            </div>
            <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-center gap-1 text-[11.5px] font-black text-indigo-700 py-1">
              {open ? "Hide breakdown" : "Breakdown — by timeframe, market and day"}
              <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="space-y-3">
                {r.groups.length > 1 && <Table title="By timeframe / rules" rows={r.groups} />}
                {market === "ALL" && r.markets.length > 1 && <Table title="By market" rows={r.markets} />}
                <Table title="Last trading days" rows={r.days} />
              </div>
            )}
          </>
        )}
        <p className="text-[9.5px] text-slate-400 leading-snug">
          {`Net = the real exit premium minus the entry (time decay is already inside that premium), less estimated direct costs of ₹${EST_COST_RS.CRUDEOIL} Crude / ₹${EST_COST_RS.NATURALGAS} NG per call (spread, brokerage, taxes)`}
          {r.duplicatesSkipped ? `; ${r.duplicatesSkipped} duplicate cop${r.duplicatesSkipped === 1 ? "y" : "ies"} from a second device not counted` : ""}.
          {note ? ` ${note}` : ""}
        </p>
      </div>
    </section>
  );
}

const TRUST_ENGINE: EngineDef = { id: "trust", label: "Ai-Trust", prefix: "TRUST", route: "/ai-trust" };

/** Ai-Trust's calls live in the server's Trade Card log, not the app's trade log. */
function TrustPageReport() {
  const q = useTradeCardLog();
  const logs = useMemo(() => {
    const out: Record<string, TradeLogEntry[]> = {};
    for (const sym of ["CRUDEOIL", "NATURALGAS"] as const) {
      for (const c of q.data?.[sym] ?? []) {
        const e = toLogEntry(c);
        if (!e) continue; // logged before option prices were saved with calls
        const key = `TRUST-${sym}-${c.tier ?? "card"}`;
        (out[key] ??= []).push(e);
      }
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.openedAt - b.openedAt);
    return out;
  }, [q.data]);
  return <PageTradeReport engine={TRUST_ENGINE} logs={logs} note="Ai-Trust calls close on futures levels; the option exit is estimated from that by delta." />;
}

/** The report for whichever page is open -- nothing on pages that make no calls. */
export function PageReportStrip() {
  const { pathname } = useLocation();
  const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (clean === TRUST_ENGINE.route) return <TrustPageReport />;
  const route = ROUTE_ALIAS[clean] ?? clean;
  const engine = ENGINES.find((e) => e.route === route);
  if (!engine) return null;
  const only = ROUTE_KEYS[route];
  return <PageTradeReport key={engine.id} engine={only ? { ...engine, label: only.label } : engine} keyFilter={only?.only} />;
}
