import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickChart, Maximize2, Minimize2 } from "lucide-react";
import { useCandles, useHistory30m, useHistory5m } from "../api/hooks";
import { useAppStore } from "../store/appStore";
import { resampleCandles } from "../utils/candleResample";
import { findZones } from "../utils/zones";
import { findFvgs, trendChannel, whereNow } from "../utils/chartMarks";
import { keyLevels } from "../utils/checklist";
import { atr } from "../utils/indicators";
import { chartLevels, findSrLevels } from "../utils/srLevels";
import { callMarks, pageScores, type CallMark, type ChartSym } from "../utils/callMarks";
import { periodStart } from "../utils/pageReport";
import { ProChart, type ProChartHandle } from "../components/aichart/ProChart";
import { chartTime } from "../components/aichart/chartStyle";
import type { StarMark, ZoneBox } from "../components/aichart/primitives";
import { CallDetail, CallList, Legend, LevelChips, MarksTable, StarBadge, type ScorePeriod } from "../components/aichart/ChartPanels";
import type { Candle } from "../types";

// Ai-Chart: one big chart that answers "where is the price, what holds it,
// and who called what" -- strong support (thick green), weak support (yellow),
// strong rejection (thick red), weak rejection (pink), buyer / seller zones,
// pivots, and every page's CE / PE call as a star with the page's letter
// inside (B Best Call, 20 Ai20-20, L Ai Lite, T Ai-Today ...), with each
// page's success rate in a table under the chart.
// Landscape full screen for the best view.

type Tf = "5" | "15" | "60";
const TF_MS: Record<Tf, number> = { "5": 5 * 60_000, "15": 15 * 60_000, "60": 60 * 60_000 };
const LAYERS = ["levels", "zones", "pivots", "calls", "channel"] as const;
type Layer = (typeof LAYERS)[number];
const LAYER_LABEL: Record<Layer, string> = { levels: "Levels", zones: "Zones", pivots: "Pivots", calls: "Calls", channel: "Channel" };

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

/** Average high-low range of the last 20 IST days (for how far from price levels are drawn). */
function dayRange(c: Candle[]): number {
  const by = new Map<string, { h: number; l: number }>();
  for (const k of c) {
    const d = new Date(Date.parse(k.date) + 5.5 * 3600_000).toISOString().slice(0, 10);
    const r = by.get(d);
    by.set(d, r ? { h: Math.max(r.h, k.high), l: Math.min(r.l, k.low) } : { h: k.high, l: k.low });
  }
  const ranges = [...by.values()].slice(-20).map((r) => r.h - r.l);
  return ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
}

export function AiChartPage() {
  const [sym, setSym] = useState<ChartSym>(() => read("aichart.sym", "CRUDEOIL"));
  const [tf, setTf] = useState<Tf>(() => read("aichart.tf", "15"));
  const [on, setOn] = useState<Record<Layer, boolean>>(() => read("aichart.layers", { levels: true, zones: true, pivots: true, calls: true, channel: false }));
  const [hidden, setHidden] = useState<string[]>([]);
  // Live calls only (running, real money) unless the trader asks for the past ones too.
  const [past, setPast] = useState<boolean>(() => read("aichart.past", false));
  const [selected, setSelected] = useState<string | null>(null);
  const [period, setPeriod] = useState<ScorePeriod>(() => read("aichart.period", "30d"));
  const [full, setFull] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const chart = useRef<ProChartHandle>(null);
  useEffect(() => save("aichart.sym", sym), [sym]);
  useEffect(() => save("aichart.tf", tf), [tf]);
  useEffect(() => save("aichart.layers", on), [on]);
  useEffect(() => save("aichart.past", past), [past]);
  useEffect(() => save("aichart.period", period), [period]);

  const live = useCandles(sym, "5");
  const hist5 = useHistory5m(sym);
  const h30 = useHistory30m(sym, true);
  const tradeLogs = useAppStore((s) => s.tradeLogs);

  // 5-minute candles: live while MCX is open, else the last 20 days of history.
  const liveBars = live.data && "candles" in live.data && live.data.candles.length >= 60 ? live.data.candles : null;
  const c5 = useMemo(() => liveBars ?? hist5.data?.candles ?? [], [liveBars, hist5.data]);
  const bars = useMemo(() => (tf === "5" ? c5 : resampleCandles(c5, Number(tf))), [c5, tf]);
  const c15 = useMemo(() => resampleCandles(c5, 15), [c5]);
  // Levels read on 30-minute candles: 90 days of history plus the recent days rebuilt from 5-minute candles.
  const c30 = useMemo(() => {
    const recent = resampleCandles(c5, 30);
    const first = recent.length ? Date.parse(recent[0].date) : Infinity;
    const old = h30.data && "candles" in h30.data ? (h30.data.candles as Candle[]).filter((k) => Date.parse(k.date) < first) : [];
    return [...old, ...recent];
  }, [c5, h30.data]);
  const price = c5.length ? c5[c5.length - 1].close : null;
  const dec = price !== null && price < 1000 ? 2 : 0;

  const levels = useMemo(() => (price === null ? [] : chartLevels(findSrLevels(c30, price), price, 3 * dayRange(c30) || price * 0.03)), [c30, price]);
  const zoneMap = useMemo(() => findZones(c15, price), [c15, price]);
  const fvgs = useMemo(() => findFvgs(bars), [bars]);
  const zones: ZoneBox[] = useMemo(() => {
    const out: ZoneBox[] = [];
    for (const z of zoneMap?.buyer.slice(0, 2) ?? []) out.push({ from: null, low: z.low, high: z.high, fill: "rgba(16,185,129,.16)", stroke: "#059669", label: `BUYER ZONE ${z.at}` });
    for (const z of zoneMap?.seller.slice(0, 2) ?? []) out.push({ from: null, low: z.low, high: z.high, fill: "rgba(244,63,94,.16)", stroke: "#E11D48", label: `SELLER ZONE ${z.at}` });
    for (const f of fvgs) out.push({ from: chartTime(Date.parse(bars[f.index].date)), low: f.low, high: f.high, fill: f.kind === "bull" ? "rgba(16,185,129,.09)" : "rgba(244,63,94,.09)", stroke: f.kind === "bull" ? "#10B981" : "#F43F5E", label: f.kind === "bull" ? "BUY gap" : "SELL gap" });
    return out;
  }, [zoneMap, fvgs, bars]);
  const pivots = useMemo(() => keyLevels(c15), [c15]);
  const channel = useMemo(() => (bars.length >= 30 ? trendChannel(bars.slice(-96)) : null), [bars]);
  const marks = useMemo(() => callMarks(tradeLogs, sym, bars, TF_MS[tf]), [tradeLogs, sym, bars, tf]);
  const base = useMemo(() => (past ? marks : marks.filter((m) => !m.entry.closed && !m.practice)), [marks, past]);
  const shownMarks = useMemo(() => base.filter((m) => !hidden.includes(m.tag)), [base, hidden]);
  const stars: StarMark[] = useMemo(() => shownMarks.map((m) => ({ id: m.id, time: chartTime(m.barTime), price: m.price, side: m.side, code: m.code, practice: m.practice, live: !m.entry.closed })), [shownMarks]);
  const pages = useMemo(() => [...new Map(base.map((m) => [m.tag, m.code])).entries()], [base]);
  const scores = useMemo(() => pageScores(tradeLogs, sym, periodStart(period, Date.now())), [tradeLogs, sym, period]);
  const pick = marks.find((m) => m.id === selected) ?? null;

  const now = useMemo(() => {
    if (price === null || !c15.length) return null;
    const buy = [...(zoneMap?.buyer.slice(0, 2) ?? []), ...fvgs.filter((f) => f.kind === "bull")];
    const sell = [...(zoneMap?.seller.slice(0, 2) ?? []), ...fvgs.filter((f) => f.kind === "bear")];
    return whereNow(price, buy, sell, atr(c15, 14) ?? 1);
  }, [price, c15, zoneMap, fvgs]);
  const nearS = levels.filter((l) => l.kind === "support" && l.tier === "strong").sort((a, b) => b.price - a.price)[0];
  const nearR = levels.filter((l) => l.kind === "resistance" && l.tier === "strong").sort((a, b) => a.price - b.price)[0];

  // Landscape: full screen and turn the phone sideways where the browser allows it.
  const goFull = async () => {
    setFull(true);
    try {
      await wrap.current?.requestFullscreen?.();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {
      /* not supported (e.g. iPhone): the page still fills the screen */
    }
  };
  const exitFull = async () => {
    setFull(false);
    try {
      screen.orientation.unlock?.();
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* already out */
    }
  };
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const focusMark = (m: CallMark) => {
    setSelected(m.id);
    chart.current?.focus(chartTime(m.barTime));
  };
  const tone = now ? (now.state === "at_buy" || now.state === "broke_sell" ? "#059669" : now.state === "at_sell" || now.state === "broke_buy" ? "#E11D48" : "#2563EB") : "#64748B";

  const toolbar = (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(["CRUDEOIL", "NATURALGAS"] as const).map((s) => (
        <button key={s} onClick={() => setSym(s)} className={`text-[12px] font-black rounded-xl px-3 py-1.5 ${sym === s ? "bg-white text-violet-700 shadow" : "bg-white/20 text-white"}`}>
          {s === "CRUDEOIL" ? "🛢️ Crude" : "🔥 NG"}
        </button>
      ))}
      <span className="w-px h-5 bg-white/30 mx-0.5" />
      {(["5", "15", "60"] as const).map((t) => (
        <button key={t} onClick={() => setTf(t)} className={`text-[12px] font-black rounded-xl px-2.5 py-1.5 ${tf === t ? "bg-white text-violet-700 shadow" : "bg-white/20 text-white"}`}>
          {t === "60" ? "1h" : `${t}m`}
        </button>
      ))}
      <button onClick={full ? exitFull : goFull} className="ml-auto flex items-center gap-1 text-[12px] font-black rounded-xl px-3 py-1.5 bg-white text-violet-700 shadow" aria-label={full ? "Exit full screen" : "Landscape full screen"}>
        {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        {full ? "Exit" : "Landscape"}
      </button>
    </div>
  );

  const chips = (
    <div className="flex items-center gap-1 flex-wrap">
      {LAYERS.map((l) => (
        <button key={l} onClick={() => setOn((o) => ({ ...o, [l]: !o[l] }))} className={`text-[11px] font-black rounded-lg px-2 py-1 ${on[l] ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-500"}`}>
          {LAYER_LABEL[l]}
        </button>
      ))}
      {on.calls && (
        <button onClick={() => setPast((v) => !v)} className={`text-[11px] font-black rounded-lg px-2 py-1 ${past ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-500"}`}>
          {past ? "Past calls ✓" : "Past calls"}
        </button>
      )}
      {on.calls &&
        pages.map(([t, code]) => (
          <button key={t} onClick={() => setHidden((h) => (h.includes(t) ? h.filter((x) => x !== t) : [...h, t]))} className={`flex items-center gap-1 text-[11px] font-black rounded-lg pl-1 pr-2 py-0.5 border ${hidden.includes(t) ? "border-slate-200 text-slate-400 opacity-60" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
            <StarBadge code={code} size={18} />
            {`${t} ${base.filter((m) => m.tag === t).length}`}
          </button>
        ))}
    </div>
  );

  const ready = bars.length >= 30 && price !== null;
  return (
    <div className="-mx-4 -mt-4 px-3 pt-3 pb-6 min-h-screen space-y-3 text-slate-800" style={{ background: "linear-gradient(180deg,#F5F3FF 0%,#EFF6FF 50%,#F8FAFC 100%)" }}>
      <div ref={wrap} className={full ? "fixed inset-0 z-[70] bg-white flex flex-col p-2 gap-1.5" : "rounded-3xl overflow-hidden shadow-lg bg-white"}>
        <div className={`${full ? "rounded-xl" : ""} px-3 py-2.5 space-y-2`} style={{ background: "linear-gradient(135deg,#7C3AED,#2563EB 60%,#0EA5E9)" }}>
          {!full && (
            <div className="flex items-center gap-2 text-white">
              <CandlestickChart size={20} />
              <h1 className="text-[18px] font-black">Ai-Chart</h1>
              <span className="text-[11px] font-bold text-white/85">levels · zones · every page's calls</span>
            </div>
          )}
          {toolbar}
        </div>
        <div className={full ? "px-1" : "px-3 pt-2"}>{chips}</div>
        {now && ready && (
          <p className={`${full ? "mx-1" : "mx-3"} rounded-xl px-2.5 py-1.5 text-[11.5px] font-black text-white leading-snug`} style={{ background: tone }}>
            {`● ${now.short}: ${now.text}`}
            {nearS && ` · strong support ${nearS.price.toFixed(dec)}`}
            {nearR && ` · strong rejection ${nearR.price.toFixed(dec)}`}
          </p>
        )}
        <div className={full ? "flex-1 min-h-0" : "h-[460px] px-1"}>
          {ready ? (
            <ProChart ref={chart} candles={bars} viewKey={`${sym}-${tf}`} levels={on.levels ? levels : []} pivots={on.pivots ? pivots : null} zones={on.zones ? zones : []} channel={on.channel ? channel : null} stars={on.calls ? stars : []} selected={selected} onSelect={setSelected} decimals={dec} />
          ) : (
            <p className="text-[12px] text-slate-500 p-6 text-center">{live.isLoading || hist5.isLoading ? "Loading candles…" : "No candles yet — log in to Upstox for the day so the chart can load."}</p>
          )}
        </div>
        {full && pick && (
          <div className="absolute bottom-3 left-3 max-w-[60%]">
            <CallDetail m={pick} sym={sym} onClose={() => setSelected(null)} />
          </div>
        )}
        {!full && (
          <div className="px-3 pb-3 pt-1 space-y-2">
            {!liveBars && ready && <p className="text-[10.5px] font-black text-amber-700">Market closed — showing the last session.</p>}
            <Legend />
          </div>
        )}
      </div>

      {!full && pick && <CallDetail m={pick} sym={sym} onClose={() => setSelected(null)} />}
      {!full && <MarksTable scores={scores} sym={sym} period={period} onPeriod={setPeriod} />}
      {!full && ready && levels.length > 0 && (
        <section className="rounded-3xl bg-white shadow-md p-3.5 space-y-2">
          <p className="text-[13px] font-black text-slate-800">Levels in numbers</p>
          <LevelChips levels={levels} price={price!} decimals={dec} />
          <p className="text-[10.5px] text-slate-400 leading-snug">Found on 30-minute candles over the last 90 days: where price turned (a bounce or a rejection of at least one candle range) at least twice. Strong = 4 or more separate turns, weak = 2 or 3. A level can break — keep a stop.</p>
        </section>
      )}
      {!full && (
        <section className="rounded-3xl bg-white shadow-md p-3.5 space-y-2">
          <p className="text-[13px] font-black text-slate-800">{past ? `Calls on this chart (${shownMarks.length})` : `Live calls now (${shownMarks.length})`}</p>
          <CallList marks={shownMarks} sym={sym} onPick={focusMark} live={!past} />
        </section>
      )}
    </div>
  );
}
