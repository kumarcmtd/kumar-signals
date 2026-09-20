// AI Backtest Lab -- how the Pullback/Reversal engine actually performed.
//
// A NEW page. It runs the SAME evaluatePullbackReversal() the live card runs;
// there is no separate backtest formula, so the two are directly comparable.
//
// The run happens IN THE BROWSER, in chunks, with a progress bar. A Cloudflare
// Worker invocation gets 10 ms of CPU on this plan and ~1,300 engine
// evaluations is seconds of it -- we hit that ceiling twice this week already.
// The phone has no such limit, the candles arrive in one KV-cached request, and
// nothing about this page touches the Upstox rate limit.
//
// Three things are deliberately absent, and the page says so rather than
// quietly approximating them: news in historical signals (no archive exists),
// a 15-minute horizon (the data is 30-minute bars), and any claim of
// significance on a small sample.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Play, Download, AlertTriangle, Info, Loader2, CheckCircle2, XCircle, MinusCircle, Lightbulb } from "lucide-react";
import { useHistory30m } from "../api/hooks";
import {
  createBacktestRunner, summarise, calibration, byRegime, byTimeOfDay, bySplit,
  overfittingWarning, supportTest, failureCases, toCsv, THRESHOLDS, HORIZONS,
  type BacktestRun, type Threshold, type Breakdown,
} from "../utils/backtestEngine";
import { buildPlainSummary, type Grade } from "../utils/backtestPlainSummary";
import type { InstrumentSymbol } from "../types";

const SYMBOLS: { key: InstrumentSymbol; label: string }[] = [
  { key: "CRUDEOIL", label: "Crude Oil" },
  { key: "NATURALGAS", label: "Natural Gas" },
];

const SAMPLE_INK = { insufficient: "#DC2626", limited: "#D97706", useful: "#15803D" } as const;

function pct(n: number | null, d = 0) {
  return n === null ? "—" : `${(n * 100).toFixed(d)}%`;
}

function Stat({ label, value, ink, note }: { label: string; value: string; ink?: string; note?: string }) {
  return (
    <div className="rounded-xl bg-white border border-[var(--color-border)] px-2.5 py-2">
      <p className="text-[9px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-[15px] font-black leading-tight" style={{ color: ink ?? "#334155" }}>{value}</p>
      {note && <p className="text-[8.5px] text-slate-400 mt-0.5">{note}</p>}
    </div>
  );
}

function BreakdownTable({ rows, title, note }: { rows: Breakdown[]; title: string; note?: string }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-[13px] font-black text-slate-800">{title}</h2>
      {note && <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">{note}</p>}
      <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
        {rows.map((r) => {
          const decided = r.success + r.failure;
          return (
            <div key={r.key} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-slate-100">
              <span className="text-[11px] font-bold text-slate-700 w-[100px] shrink-0 capitalize">{r.label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden min-w-0">
                {r.successPct !== null && <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r.successPct}%` }} />}
              </div>
              <span className="text-[10px] font-black tabular-nums w-[36px] text-right shrink-0 text-slate-700">
                {r.successPct === null ? "—" : `${r.successPct}%`}
              </span>
              <span className="text-[9px] text-slate-400 tabular-nums w-[52px] text-right shrink-0">
                {decided}/{r.signals}
              </span>
            </div>
          );
        })}
        <p className="px-3 py-1.5 text-[9px] text-slate-400 bg-slate-50">
          The right-hand figure is decided signals over total. Anything that reached neither target nor stop inside the horizon stays undecided and is never counted as a win.
        </p>
      </div>
    </section>
  );
}

const GRADE_VISUAL: Record<Grade, { ink: string; bg: string; border: string; heading: string }> = {
  good: { ink: "#15803D", bg: "linear-gradient(135deg,#DCFCE7,#F0FDF4)", border: "#86EFAC", heading: "Worth using" },
  borderline: { ink: "#B45309", bg: "linear-gradient(135deg,#FEF3C7,#FFFBEB)", border: "#FCD34D", heading: "About a coin flip" },
  poor: { ink: "#B91C1C", bg: "linear-gradient(135deg,#FEE2E2,#FEF2F2)", border: "#FCA5A5", heading: "Did not work" },
  unusable: { ink: "#475569", bg: "linear-gradient(135deg,#F1F5F9,#F8FAFC)", border: "#CBD5E1", heading: "Can't tell yet" },
};

const TONE_ICON = { good: CheckCircle2, bad: XCircle, neutral: MinusCircle } as const;
const TONE_INK = { good: "#15803D", bad: "#B91C1C", neutral: "#64748B" } as const;

/**
 * The results in plain words, placed ABOVE every technical figure.
 *
 * The numbers below it are all correct and all meaningless to someone who does
 * not already know what precision or a calibration band is. This answers the
 * five questions a trader actually has, in the order they matter, and states a
 * bad result plainly instead of leaving it to be worked out from a table.
 */
function PlainSummaryCard({ plain }: { plain: ReturnType<typeof buildPlainSummary> }) {
  const v = GRADE_VISUAL[plain.grade];
  return (
    <section>
      <h2 className="text-[13px] font-black text-slate-800 mb-1.5">What this all means</h2>

      <div className="rounded-2xl p-3.5 border" style={{ background: v.bg, borderColor: v.border }}>
        <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: v.ink }}>{v.heading}</p>
        <p className="text-[14px] font-black leading-tight mt-0.5" style={{ color: v.ink }}>{plain.verdict}</p>
        <p className="text-[10.5px] text-slate-700 leading-snug mt-1.5">{plain.verdictDetail}</p>
      </div>

      <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden mt-2">
        {plain.points.map((pt) => {
          const Icon = TONE_ICON[pt.tone];
          return (
            <div key={pt.question} className="px-3 py-2.5 border-b last:border-b-0 border-slate-100">
              <div className="flex items-start gap-1.5">
                <Icon size={12} className="shrink-0 mt-[2px]" style={{ color: TONE_INK[pt.tone] }} />
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-slate-800">{pt.question}</p>
                  <p className="text-[11px] font-bold mt-0.5" style={{ color: TONE_INK[pt.tone] }}>{pt.answer}</p>
                  <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5">{pt.meaning}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl px-3 py-2.5 mt-2" style={{ background: "#EEF2FF", border: "1px solid #C7D2FE" }}>
        <p className="text-[10.5px] font-black text-indigo-900 flex items-center gap-1.5">
          <Lightbulb size={12} className="shrink-0" />
          What to do next
        </p>
        <ul className="mt-1 space-y-1">
          {plain.actions.map((a) => (
            <li key={a} className="text-[10px] text-slate-700 leading-snug flex gap-1.5">
              <span className="text-indigo-400 shrink-0">•</span>
              {a}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function AiBacktestLab() {
  const [symbol, setSymbol] = useState<InstrumentSymbol>("NATURALGAS");
  const [threshold, setThreshold] = useState<Threshold>(1);
  const [horizonKey, setHorizonKey] = useState("4h");
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  const history = useHistory30m(symbol, true);
  const horizon = HORIZONS.find((h) => h.key === horizonKey) ?? HORIZONS[3];

  // A new instrument invalidates the previous run.
  useEffect(() => {
    setRun(null);
    setProgress(0);
  }, [symbol]);

  useEffect(() => () => { cancelled.current = true; }, []);

  const start = useCallback(async () => {
    const candles = history.data?.candles;
    if (!candles || candles.length === 0 || running) return;
    cancelled.current = false;
    setRunning(true);
    setRun(null);
    setProgress(0);

    const runner = createBacktestRunner(candles, { commodity: symbol as "CRUDEOIL" | "NATURALGAS", step: 1 });
    // Chunked with a yield between batches so the phone stays responsive and
    // the progress bar actually moves.
    const tick = () =>
      new Promise<boolean>((resolve) => {
        setTimeout(() => {
          const done = runner.step(25);
          setProgress(runner.progress());
          resolve(done);
        }, 0);
      });

    let done = false;
    while (!done && !cancelled.current) done = await tick();
    if (!cancelled.current) {
      setRun(runner.result());
      setProgress(100);
    }
    setRunning(false);
  }, [history.data, running, symbol]);

  const summary = useMemo(() => (run ? summarise(run.signals, threshold, horizon.bars) : null), [run, threshold, horizon]);
  const bands = useMemo(() => (run ? calibration(run.signals, threshold, horizon.bars) : []), [run, threshold, horizon]);
  const splits = useMemo(() => (run ? bySplit(run.signals, threshold, horizon.bars) : []), [run, threshold, horizon]);
  const regimes = useMemo(() => (run ? byRegime(run.signals, threshold, horizon.bars) : []), [run, threshold, horizon]);
  const hours = useMemo(() => (run ? byTimeOfDay(run.signals, threshold, horizon.bars) : []), [run, threshold, horizon]);
  const support = useMemo(() => (run ? supportTest(run.signals, threshold, horizon.bars) : []), [run, threshold, horizon]);
  const failures = useMemo(() => (run ? failureCases(run.signals, threshold, horizon.bars, 10) : []), [run, threshold, horizon]);
  const overfit = useMemo(() => overfittingWarning(splits), [splits]);
  const plain = useMemo(
    () => (summary ? buildPlainSummary(summary, bands, splits, hours, threshold, horizon.label) : null),
    [summary, bands, splits, hours, threshold, horizon]
  );

  const downloadCsv = () => {
    if (!run) return;
    const blob = new Blob([toCsv(run, threshold, horizon.bars)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-${symbol}-${threshold}atr-${horizon.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-center gap-2">
        <FlaskConical size={20} className="text-indigo-600" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-black leading-none text-slate-900">AI Backtest Lab</h1>
          <p className="text-[9.5px] text-slate-500 mt-0.5">How the Pullback engine actually did — same engine, past data</p>
        </div>
      </header>

      <div className="flex gap-2">
        {SYMBOLS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSymbol(key)}
            disabled={running}
            className="flex-1 py-2 rounded-xl text-[11.5px] font-black disabled:opacity-50"
            style={symbol === key ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The caveat that governs every number below it. */}
      <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 bg-amber-50 border border-amber-200">
        <Info size={13} className="shrink-0 mt-0.5 text-amber-600" />
        <div>
          <p className="text-[10.5px] font-bold text-amber-800">Technical only — and that is deliberate</p>
          <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
            This app keeps about 48 hours of news and no archive, so a past signal cannot know what was reported that day. Replaying today's headlines over old candles would be look-ahead bias and
            would make these numbers look far better than they are. Every backtested signal here is chart-only. The live page does use news — so expect them to differ.
          </p>
        </div>
      </div>

      {history.isLoading && <div className="h-16 rounded-2xl bg-slate-100 motion-safe:animate-pulse" />}
      {history.error && (
        <div className="rounded-2xl px-3 py-2.5 bg-red-50 border border-red-200">
          <p className="text-[11.5px] font-black text-red-700">Couldn't load the history</p>
          <p className="text-[10px] text-red-700/80 mt-0.5">{(history.error as Error).message}</p>
        </div>
      )}
      {history.data?.error && (
        <div className="rounded-2xl px-3 py-2.5 bg-amber-50 border border-amber-200">
          <p className="text-[10.5px] font-bold text-amber-800">{history.data.error}</p>
        </div>
      )}

      {history.data?.candles && history.data.candles.length > 0 && (
        <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-3">
          <p className="text-[10.5px] text-slate-600">
            {history.data.candles.length.toLocaleString("en-IN")} thirty-minute bars of {history.data.tradingSymbol ?? symbol} are loaded.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={running}
            className="w-full mt-2 py-2.5 rounded-xl text-[12.5px] font-black flex items-center justify-center gap-1.5 disabled:opacity-60"
            style={{ background: "#4F46E5", color: "#fff" }}
          >
            {running ? <Loader2 size={13} className="motion-safe:animate-spin" /> : <Play size={13} />}
            {running ? `Running… ${progress}%` : run ? "Run again" : "Run the backtest"}
          </button>
          {running && (
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          <p className="text-[9px] text-slate-400 mt-1.5 leading-snug">
            This runs on your phone, not the server — the free Worker plan allows 10ms of processing per request and this needs seconds. Nothing here touches the Upstox rate limit.
          </p>
        </div>
      )}

      {run && summary && (
        <>
          {/* Controls */}
          <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5 space-y-2">
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Target &amp; stop, in ATR</p>
              <div className="flex gap-1.5">
                {THRESHOLDS.map((t) => (
                  <button key={t} type="button" onClick={() => setThreshold(t)} className="flex-1 py-1.5 rounded-lg text-[10.5px] font-bold"
                    style={threshold === t ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}>
                    {t} ATR
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase text-slate-400 mb-1">Measured within</p>
              <div className="flex gap-1.5">
                {HORIZONS.map((h) => (
                  <button key={h.key} type="button" onClick={() => setHorizonKey(h.key)} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold"
                    style={horizonKey === h.key ? { background: "#4F46E5", color: "#fff" } : { background: "var(--color-surface-soft)", color: "#64748B" }}>
                    {h.label}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-slate-400 mt-1">A 15-minute horizon isn't listed because the history is 30-minute bars — it can't be measured, so it isn't guessed.</p>
            </div>
          </div>

          {/* Sample honesty first */}
          <div className="rounded-xl px-3 py-2.5" style={{ background: `${SAMPLE_INK[summary.sampleLabel]}10`, border: `1px solid ${SAMPLE_INK[summary.sampleLabel]}44` }}>
            <p className="text-[10.5px] font-bold" style={{ color: SAMPLE_INK[summary.sampleLabel] }}>
              {summary.sampleLabel === "insufficient" ? "Insufficient sample" : summary.sampleLabel === "limited" ? "Limited sample" : "Usable sample"}
            </p>
            <p className="text-[10px] text-slate-600 leading-snug mt-0.5">{summary.sampleNote}</p>
          </div>

          {plain && <PlainSummaryCard plain={plain} />}

          <section>
            <h2 className="text-[13px] font-black text-slate-800 mb-2">Headline results</h2>
            <p className="text-[10px] text-slate-500 leading-snug mb-1.5">
              The raw figures behind the summary above. "Green" means it expected price up, "Red" expected down, "Yellow" means it said wait and is never scored. "Undecided"
              reached neither the target nor the stop in time and never counts as a win.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Signals" value={String(summary.total)} note={`${run.meta.evaluated} bars checked`} />
              <Stat label="Green" value={String(summary.green)} ink="#15803D" note={`${summary.greenSuccess} right`} />
              <Stat label="Red" value={String(summary.red)} ink="#B91C1C" note={`${summary.redSuccess} right`} />
              <Stat label="Yellow (wait)" value={String(summary.yellow)} ink="#B45309" note="never scored" />
              <Stat label="Undecided" value={String(summary.unknown)} note="hit neither side" />
              <Stat label="False green" value={summary.falseGreenPct === null ? "—" : `${summary.falseGreenPct}%`} ink="#B91C1C" />
              <Stat label="False red" value={summary.falseRedPct === null ? "—" : `${summary.falseRedPct}%`} ink="#B91C1C" />
              <Stat label="Precision" value={pct(summary.precision, 1)} />
              <Stat label="F1" value={summary.f1 === null ? "—" : summary.f1.toFixed(2)} />
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-black text-slate-800">How far price ran</h2>
            <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">
              In ATR units, so it is comparable across both commodities. This is what a realistic target and stop distance look like.
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              <Stat label="Avg in favour" value={`${summary.avgMfeAtr.toFixed(2)}×`} ink="#15803D" />
              <Stat label="Avg against" value={`${summary.avgMaeAtr.toFixed(2)}×`} ink="#B91C1C" />
              <Stat label="Best" value={`${summary.maxMfeAtr.toFixed(1)}×`} />
              <Stat label="Worst" value={`${summary.maxMaeAtr.toFixed(1)}×`} />
            </div>
          </section>

          {/* Calibration */}
          <section>
            <h2 className="text-[13px] font-black text-slate-800">Does the confidence mean anything?</h2>
            <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">
              What the engine claimed against what actually happened. If it says 80% and delivers 55%, that is a problem worth seeing, not hiding.
            </p>
            <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
              {bands.map((b) => (
                <div key={b.label} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-slate-100">
                  <span className="text-[11px] font-bold text-slate-700 w-[52px] shrink-0">{b.label}</span>
                  <span className="text-[10px] text-slate-400 w-[54px] shrink-0">{b.signals} sig.</span>
                  <span className="text-[11px] font-black tabular-nums" style={{ color: b.miscalibrated ? "#B91C1C" : "#334155" }}>
                    {b.actualPct === null ? "—" : `${b.actualPct}% actual`}
                  </span>
                  {b.miscalibrated && (
                    <span className="ml-auto text-[9px] font-black px-1.5 py-[1px] rounded-md bg-red-100 text-red-700 shrink-0">Overclaiming</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Walk-forward */}
          <BreakdownTable
            rows={splits}
            title="Walk-forward split"
            note="Chronological 60/20/20. The out-of-sample slice is the only one that was never used to shape the rules — it is the number that counts."
          />
          {overfit && (
            <div className="rounded-xl px-3 py-2.5 flex items-start gap-2 bg-amber-50 border border-amber-200">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              <p className="text-[10px] text-slate-700 leading-snug">{overfit}</p>
            </div>
          )}

          <BreakdownTable rows={support} title="When price fell to support" note="Your hypothesis, measured: does support actually hold, and does price recover from it?" />
          <BreakdownTable rows={regimes} title="By market regime" note="A rule that works in a strong trend can fail badly in chop. Measured separately." />
          <BreakdownTable rows={hours} title="By time of day (IST)" note="Cross-check this against Price-Alerts — the busiest hours are not always the most reliable ones." />

          {/* Failure analysis */}
          {failures.length > 0 && (
            <section>
              <h2 className="text-[13px] font-black text-slate-800">Where it was wrong</h2>
              <p className="text-[10px] text-slate-500 leading-snug mt-0.5 mb-1.5">The most recent losing calls, with what the engine believed at the time.</p>
              <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
                {failures.map((f) => (
                  <div key={f.t} className="px-3 py-2 border-b last:border-b-0 border-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-700">
                        {new Date(f.t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                      </span>
                      <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md" style={{ background: f.state === "still_bullish" ? "#DCFCE7" : "#FEE2E2", color: f.state === "still_bullish" ? "#15803D" : "#B91C1C" }}>
                        {f.state === "still_bullish" ? "GREEN" : "RED"} {f.confidence}%
                      </span>
                      <span className="ml-auto text-[9px] text-slate-400 tabular-nums">{f.price} · {f.regime.replace(/_/g, " ")}</span>
                    </div>
                    <p className="text-[9.5px] text-slate-500 leading-snug mt-0.5">{f.topReason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <button type="button" onClick={downloadCsv} className="w-full py-2.5 rounded-xl text-[12px] font-black flex items-center justify-center gap-1.5 bg-[var(--color-surface-soft)] text-[var(--color-muted)]">
            <Download size={13} /> Export every signal as CSV
          </button>

          <p className="text-[9.5px] text-slate-400 leading-relaxed px-1">
            {run.meta.sessions} sessions of {run.meta.commodity}, {run.meta.firstDate} to {run.meta.lastDate}, {run.meta.bars.toLocaleString("en-IN")} thirty-minute bars. At every historical bar the
            engine saw only the bars up to that point — no future candle, level or indicator value can reach a past signal. Past performance does not predict future results, one contract's history is
            not "the market", and a small sample can look convincing purely by luck.
          </p>
        </>
      )}
    </div>
  );
}
