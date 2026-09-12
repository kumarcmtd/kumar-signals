// Presentational building blocks for the GPT News page.
//
// Self-contained on purpose: nothing here is imported by any other page, so
// GPT News can be restyled or rebuilt without touching the rest of the app.
// Every component below is driven entirely by props computed in
// gptNewsEngine.ts -- none of them fetch, and none of them invent a value to
// fill a gap. Where a number is genuinely unavailable they render an explicit
// "not available" state rather than a zero or a dash that reads like data.
//
// Colour semantics (spec section 29): GREEN bullish, RED bearish, YELLOW
// caution, GRAY neutral -- always accompanied by a text label, so meaning never
// depends on colour alone.

import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, AlertTriangle, CheckCircle2, HelpCircle, Clock, Radio } from "lucide-react";
import type {
  GptNewsItem, PriorityLevel, Verification, Bias, RiskLevel, CommodityPanel, CountryRisk,
  ChokepointRead, WeatherRead, IntelligenceBlock, UpcomingEvent, PositionRead,
} from "../utils/gptNewsEngine";
import { PRIORITY_LABEL, PRIORITY_NOTE, STRENGTH_LABEL, STRENGTH_MARKS, VERIFICATION_LABEL, VERIFICATION_NOTE, CHOKEPOINT_STATUS_LABEL, CHOKEPOINT_GAUGE } from "../utils/gptNewsEngine";

export const GN = {
  bull: "#16C784",
  bear: "#F6465D",
  warn: "#F0B90B",
  flat: "#8A94A6",
  accent: "#4C8DFF",
  shock: "#FF3B30",
};

export const BIAS_COLOR: Record<Bias, string> = { bullish: GN.bull, bearish: GN.bear, neutral: GN.flat };
export const BIAS_WORD: Record<Bias, string> = { bullish: "BULLISH", bearish: "BEARISH", neutral: "NEUTRAL" };
export const RISK_COLOR: Record<RiskLevel, string> = { low: GN.flat, medium: GN.warn, high: "#FF8A3D", extreme: GN.shock };
export const PRIORITY_COLOR: Record<PriorityLevel, string> = { 5: GN.shock, 4: "#FF8A3D", 3: GN.warn, 2: GN.flat, 1: GN.flat };
export const VERIFICATION_COLOR: Record<Verification, string> = { confirmed: GN.bull, developing: GN.warn, unconfirmed: GN.bear };

/** A themed surface. The page sets --gn-* tokens; everything here reads them. */
export function Panel({ children, className, tone }: { children: ReactNode; className?: string; tone?: string }) {
  return (
    <div
      className={`rounded-2xl ${className ?? ""}`}
      style={{ background: "var(--gn-panel)", border: `1px solid ${tone ?? "var(--gn-border)"}` }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ icon, title, right, note }: { icon?: ReactNode; title: string; right?: ReactNode; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 mb-2">
      <div className="min-w-0">
        <h2 className="text-[13px] font-black flex items-center gap-1.5" style={{ color: "var(--gn-text)" }}>
          {icon}
          {title}
        </h2>
        {note && <p className="text-[10px] mt-0.5 leading-snug" style={{ color: "var(--gn-faint)" }}>{note}</p>}
      </div>
      {right}
    </div>
  );
}

export function Chip({ children, color, filled }: { children: ReactNode; color: string; filled?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[2px] rounded-md text-[9px] font-black uppercase tracking-wide whitespace-nowrap"
      style={filled ? { background: color, color: "#0A0B10" } : { background: `${color}22`, color, border: `1px solid ${color}55` }}
    >
      {children}
    </span>
  );
}

/**
 * The +++++ / ----- impact meter. Always paired with a word, never colour-only.
 * An "unknown" strength draws nothing rather than an empty row of dashes that
 * could be misread as "zero impact measured".
 */
export function MarkMeter({ label, marks, direction, max = 5 }: { label: string; marks: number; direction: Bias; max?: number }) {
  const color = BIAS_COLOR[direction];
  const symbol = direction === "bearish" ? "−" : "+";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] font-bold" style={{ color: "var(--gn-muted)" }}>{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-black text-[12px] tracking-[2px] leading-none" style={{ color: marks > 0 ? color : "var(--gn-faint)" }}>
          {marks > 0 ? symbol.repeat(Math.min(marks, max)) : "—"}
        </span>
        <span className="text-[9px] font-bold" style={{ color: marks > 0 ? color : "var(--gn-faint)" }}>
          {marks > 0 ? BIAS_WORD[direction] : "NONE"}
        </span>
      </span>
    </div>
  );
}

/** Real closes only. An empty series renders nothing at all. */
export function Sparkline({ points, color, width = 64, height = 20 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * width).toFixed(1)},${(height - ((p - min) / span) * height).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---- Market dashboard tile (spec section 7) ----
export function MarketTile({ label, sub, value, changePct, spark, unavailable }: {
  label: string; sub?: string; value: string | null; changePct: number | null; spark?: number[]; unavailable?: string;
}) {
  const dir: Bias = changePct === null ? "neutral" : changePct > 0 ? "bullish" : changePct < 0 ? "bearish" : "neutral";
  const color = BIAS_COLOR[dir];
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--gn-panel-2)", border: "1px solid var(--gn-border)" }}>
      <p className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--gn-muted)" }}>{label}</p>
      {sub && <p className="text-[8.5px] truncate" style={{ color: "var(--gn-faint)" }}>{sub}</p>}
      {value === null ? (
        <p className="text-[10px] font-bold mt-1 leading-snug" style={{ color: GN.warn }}>{unavailable ?? "Not available"}</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-1 mt-0.5">
            <p className="text-[15px] font-black leading-none" style={{ color: "var(--gn-text)" }}>{value}</p>
            {spark && spark.length > 1 && <Sparkline points={spark} color={color} width={44} height={16} />}
          </div>
          <p className="text-[10px] font-bold mt-0.5" style={{ color }}>
            {changePct === null ? "change n/a" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
          </p>
        </>
      )}
    </div>
  );
}

// ---- Breaking news card (spec section 6) ----
export function BreakingCard({ item }: { item: GptNewsItem }) {
  const [open, setOpen] = useState(false);
  const color = BIAS_COLOR[item.direction];
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--gn-panel)", border: `1.5px solid ${PRIORITY_COLOR[item.priority]}` }}>
      <div className="px-3 py-1.5 flex items-center gap-2 flex-wrap" style={{ background: `${PRIORITY_COLOR[item.priority]}1F` }}>
        <span className="flex items-center gap-1 text-[9.5px] font-black uppercase tracking-wide" style={{ color: PRIORITY_COLOR[item.priority] }}>
          <span className="relative flex w-1.5 h-1.5">
            <span className="absolute inline-flex w-full h-full rounded-full motion-safe:animate-ping" style={{ background: PRIORITY_COLOR[item.priority] }} />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_COLOR[item.priority] }} />
          </span>
          Breaking · Level {item.priority} {PRIORITY_LABEL[item.priority]}
        </span>
        <span className="text-[9.5px] font-bold ml-auto" style={{ color: "var(--gn-muted)" }}>{item.ageLabel}</span>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[13.5px] font-black leading-snug" style={{ color: "var(--gn-text)" }}>{item.headline}</p>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <Chip color={VERIFICATION_COLOR[item.verification]}>{VERIFICATION_LABEL[item.verification]}</Chip>
          <span className="text-[9.5px] font-bold" style={{ color: "var(--gn-muted)" }}>{item.primarySource}</span>
          <span className="text-[9.5px]" style={{ color: "var(--gn-faint)" }}>· {item.stamp}</span>
        </div>
        {item.sourceCount > 1 && (
          <p className="text-[9.5px] mt-1" style={{ color: GN.bull }}>Multiple-source confirmation: {item.sources.join(", ")}</p>
        )}

        <div className="mt-2 rounded-xl px-2.5 py-2 space-y-1" style={{ background: "var(--gn-panel-2)" }}>
          <p className="text-[10px] font-black uppercase" style={{ color }}>
            {item.direction === "neutral" ? "No clear direction" : `${STRENGTH_LABEL[item.strength]} ${BIAS_WORD[item.direction]}`}
            {item.asset !== "NONE" && ` · ${item.asset === "BOTH" ? "CRUDE & GAS" : item.asset === "CRUDE" ? "CRUDE" : "NATURAL GAS"}`}
          </p>
          <MarkMeter label="Crude impact" marks={item.crudeMarks} direction={item.direction} />
          <MarkMeter label="Gas impact" marks={item.gasMarks} direction={item.direction} />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold" style={{ color: "var(--gn-muted)" }}>Geopolitical risk</span>
            <Chip color={RISK_COLOR[item.geopoliticalRisk]}>{item.geopoliticalRisk}</Chip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold" style={{ color: "var(--gn-muted)" }}>Confidence</span>
            <span className="text-[10px] font-black" style={{ color: "var(--gn-text)" }}>{item.confidencePct}% · {item.confidence.toUpperCase()}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold" style={{ color: "var(--gn-muted)" }}>Likely to matter for</span>
            <span className="text-[10px] font-black" style={{ color: "var(--gn-text)" }}>{item.horizon}</span>
          </div>
        </div>

        <button type="button" onClick={() => setOpen((o) => !o)} className="w-full mt-2 flex items-center justify-center gap-1 text-[10px] font-black py-1.5 rounded-lg" style={{ background: "var(--gn-panel-2)", color: "var(--gn-muted)" }}>
          Why this matters
          <ChevronDown size={11} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
        {open && (
          <div className="mt-1.5 space-y-1.5">
            <p className="text-[10.5px] leading-snug" style={{ color: "var(--gn-muted)" }}><span className="font-black" style={{ color: "var(--gn-text)" }}>Reasoning: </span>{item.whyItMatters}</p>
            <p className="text-[10.5px] leading-snug" style={{ color: "var(--gn-muted)" }}><span className="font-black" style={{ color: "var(--gn-text)" }}>Trading significance: </span>{item.expectedEffect}</p>
            <p className="text-[9.5px] leading-snug" style={{ color: "var(--gn-faint)" }}>{VERIFICATION_NOTE[item.verification]}</p>
          </div>
        )}

        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10.5px] font-black" style={{ background: `${GN.accent}22`, color: GN.accent }}>
            <ExternalLink size={11} /> Read source
          </a>
        )}
      </div>
    </div>
  );
}

// ---- Standard news row ----
export function NewsRow({ item, fast }: { item: GptNewsItem; fast: boolean }) {
  const [open, setOpen] = useState(false);
  const color = BIAS_COLOR[item.direction];
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--gn-panel)", border: "1px solid var(--gn-border)", borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {item.isNew && <Chip color={GN.shock} filled>NEW</Chip>}
        <Chip color={PRIORITY_COLOR[item.priority]}>L{item.priority} {PRIORITY_LABEL[item.priority]}</Chip>
        <Chip color={VERIFICATION_COLOR[item.verification]}>{VERIFICATION_LABEL[item.verification]}</Chip>
        <span className="text-[9.5px] font-bold ml-auto" style={{ color: "var(--gn-muted)" }}>{item.ageLabel}</span>
      </div>
      <p className="text-[12px] font-bold leading-snug mt-1.5" style={{ color: "var(--gn-text)" }}>{item.headline}</p>
      {!fast && item.summary && (
        <p className="text-[10px] leading-snug mt-1 line-clamp-2" style={{ color: "var(--gn-faint)" }}>{item.summary}</p>
      )}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
        <span className="text-[9.5px] font-bold" style={{ color: "var(--gn-muted)" }}>{item.primarySource}</span>
        <span className="text-[9.5px]" style={{ color: "var(--gn-faint)" }}>· {item.stamp}</span>
        {item.sourceCount > 1 && <Chip color={GN.bull}>{item.sourceCount} sources</Chip>}
        <span className="ml-auto text-[9.5px] font-black" style={{ color }}>
          {item.direction === "neutral" ? "NEUTRAL" : `${BIAS_WORD[item.direction]} · ${STRENGTH_LABEL[item.strength]}`}
        </span>
      </div>

      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full mt-1.5 flex items-center justify-center gap-1 text-[9.5px] font-bold py-1 rounded-md" style={{ color: "var(--gn-faint)" }}>
        {open ? "Hide" : "Why this matters"}
        <ChevronDown size={10} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="space-y-1 pb-0.5">
          <p className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>{item.whyItMatters}</p>
          <p className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>{item.expectedEffect}</p>
          <p className="text-[9.5px] leading-snug" style={{ color: "var(--gn-faint)" }}>
            Affects: {item.asset === "NONE" ? "no direct energy read" : item.asset === "BOTH" ? "Crude & Natural Gas" : item.asset === "CRUDE" ? "Crude" : "Natural Gas"} · Horizon: {item.horizon} · Confidence {item.confidencePct}%
          </p>
          <p className="text-[9.5px] leading-snug" style={{ color: "var(--gn-faint)" }}>{VERIFICATION_NOTE[item.verification]}</p>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: GN.accent }}>
              <ExternalLink size={10} /> Read source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Commodity bias panel (spec sections 9 and 10) ----
export function BiasPanelCard({ panel }: { panel: CommodityPanel }) {
  const color = BIAS_COLOR[panel.bias];
  return (
    <Panel className="overflow-hidden" tone={`${color}55`}>
      <div className="px-3 py-2.5" style={{ background: `${color}14` }}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[9.5px] font-black uppercase tracking-wide" style={{ color: "var(--gn-muted)" }}>{panel.title} · Overall news bias</p>
            <p className="text-[17px] font-black leading-tight flex items-center gap-1.5" style={{ color }}>
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
              {panel.biasLabel}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[9px] font-bold uppercase" style={{ color: "var(--gn-muted)" }}>Confidence</p>
            <p className="text-[17px] font-black leading-none" style={{ color: "var(--gn-text)" }}>{panel.confidencePct}%</p>
          </div>
        </div>
        <p className="text-[9.5px] mt-1" style={{ color: "var(--gn-faint)" }}>
          Current bias from news flow — not a guaranteed direction.
        </p>
      </div>

      <div className="px-3 py-2.5 space-y-1.5">
        {panel.components.map((c) => (
          <div key={c.label} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10.5px] font-bold" style={{ color: "var(--gn-text)" }}>{c.label}</p>
              <p className="text-[9px] truncate" style={{ color: "var(--gn-faint)" }}>{c.detail}</p>
            </div>
            <Chip color={c.kind === "risk" ? RISK_COLOR[c.reading as RiskLevel] : BIAS_COLOR[c.reading as Bias]}>
              {c.kind === "risk" ? String(c.reading) : BIAS_WORD[c.reading as Bias]}
            </Chip>
          </div>
        ))}

        <div className="pt-1.5 mt-1 border-t" style={{ borderColor: "var(--gn-border)" }}>
          <p className="text-[9.5px] font-black uppercase mb-1" style={{ color: "var(--gn-muted)" }}>Why — actual headlines</p>
          {panel.drivers.length === 0 ? (
            <p className="text-[10px]" style={{ color: "var(--gn-faint)" }}>No directional headlines in the feed for this commodity.</p>
          ) : (
            <ul className="space-y-1">
              {panel.drivers.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="shrink-0 mt-[5px] w-1.5 h-1.5 rounded-full" style={{ background: BIAS_COLOR[d.direction] }} />
                  <span className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>
                    {d.headline} <span style={{ color: "var(--gn-faint)" }}>— {d.source}, {d.ageLabel}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pt-1.5 mt-1 border-t" style={{ borderColor: "var(--gn-border)" }}>
          <p className="text-[9.5px] font-black uppercase mb-1" style={{ color: GN.warn }}>What would flip this (interpretation)</p>
          <ul className="space-y-0.5">
            {panel.counterRisks.map((r, i) => (
              <li key={i} className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>• {r}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

// ---- Global energy risk monitor (spec section 11) ----
export function CountryCard({ c }: { c: CountryRisk }) {
  return (
    <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--gn-panel-2)", border: `1px solid ${c.mentions ? `${RISK_COLOR[c.risk]}55` : "var(--gn-border)"}` }}>
      <div className="flex items-center justify-between gap-1.5">
        <p className="text-[11px] font-black truncate" style={{ color: "var(--gn-text)" }}>
          <span className="mr-1">{c.flag}</span>{c.name}
        </p>
        <Chip color={RISK_COLOR[c.risk]}>{c.risk}</Chip>
      </div>
      <p className="text-[9.5px] leading-snug mt-1 line-clamp-2" style={{ color: c.latest ? "var(--gn-muted)" : "var(--gn-faint)" }}>
        {c.latest ? c.latest.headline : c.note}
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: "var(--gn-faint)" }}>
          Crude <span className="w-2 h-2 rounded-full" style={{ background: BIAS_COLOR[c.crudeEffect] }} /> {BIAS_WORD[c.crudeEffect]}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: "var(--gn-faint)" }}>
          Gas <span className="w-2 h-2 rounded-full" style={{ background: BIAS_COLOR[c.gasEffect] }} /> {BIAS_WORD[c.gasEffect]}
        </span>
        {c.latest && <span className="text-[9px] ml-auto" style={{ color: "var(--gn-faint)" }}>{c.latest.ageLabel}</span>}
      </div>
    </div>
  );
}

// ---- Chokepoint monitors (spec sections 12 and 13) ----
const GAUGE_STOPS = ["NORMAL", "DISRUPTED", "HIGH RISK", "BLOCKED"];

export function ChokepointCard({ read }: { read: ChokepointRead }) {
  const idx = CHOKEPOINT_GAUGE[read.status];
  const color = idx === 0 ? GN.bull : idx === 1 ? GN.warn : idx === 2 ? "#FF8A3D" : GN.shock;
  return (
    <Panel className="px-3 py-2.5" tone={`${color}44`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-black" style={{ color: "var(--gn-text)" }}>{read.name}</p>
          <p className="text-[9px] leading-snug" style={{ color: "var(--gn-faint)" }}>{read.subtitle}</p>
        </div>
        <Chip color={color} filled>{CHOKEPOINT_STATUS_LABEL[read.status]}</Chip>
      </div>

      {/* NORMAL ——— HIGH RISK ——— BLOCKED gauge */}
      <div className="mt-2.5">
        <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: "var(--gn-panel-2)" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex-1 mx-[1px] rounded-full" style={{ background: i <= idx ? color : "transparent" }} />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          {GAUGE_STOPS.map((s, i) => (
            <span key={s} className="text-[7.5px] font-bold" style={{ color: i === idx ? color : "var(--gn-faint)" }}>{s}</span>
          ))}
        </div>
      </div>

      <div className="mt-2 space-y-1">
        {read.signals.map((s) => (
          <div key={s.label} className="flex items-start gap-1.5">
            <span className="text-[9.5px] font-bold shrink-0 w-[92px]" style={{ color: "var(--gn-muted)" }}>{s.label}</span>
            <span className="text-[9.5px] leading-snug flex-1 line-clamp-2" style={{ color: s.detail.startsWith("Nothing reported") ? "var(--gn-faint)" : "var(--gn-text)" }}>{s.detail}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2 pt-2 border-t" style={{ borderColor: "var(--gn-border)" }}>
        <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: "var(--gn-faint)" }}>
          Crude <span className="w-2 h-2 rounded-full" style={{ background: BIAS_COLOR[read.crudeEffect] }} /> {BIAS_WORD[read.crudeEffect]}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: "var(--gn-faint)" }}>
          Gas <span className="w-2 h-2 rounded-full" style={{ background: BIAS_COLOR[read.gasEffect] }} /> {BIAS_WORD[read.gasEffect]}
        </span>
      </div>
      <p className="text-[9px] leading-snug mt-1.5" style={{ color: "var(--gn-faint)" }}>{read.note}</p>
    </Panel>
  );
}

// ---- Weather (spec section 14) ----
export function WeatherCard({ read }: { read: WeatherRead }) {
  const color = BIAS_COLOR[read.bias];
  return (
    <Panel className="px-3 py-2.5" tone={`${color}44`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-black" style={{ color: "var(--gn-text)" }}>🇺🇸 US Weather → Natural Gas</p>
        <Chip color={color}>{BIAS_WORD[read.bias]}</Chip>
      </div>
      <p className="text-[11px] font-bold mt-1" style={{ color }}>{read.label}</p>

      <div className="grid grid-cols-5 gap-1 mt-2">
        {read.regions.map((r) => (
          <div key={r.name} className="rounded-lg px-1 py-1.5 text-center" style={{ background: "var(--gn-panel-2)", opacity: r.mentioned ? 1 : 0.45 }}>
            <p className="text-[8.5px] font-bold truncate" style={{ color: "var(--gn-text)" }}>{r.name}</p>
            <p className="text-[7.5px]" style={{ color: "var(--gn-faint)" }}>{r.mentioned ? "in news" : "quiet"}</p>
          </div>
        ))}
      </div>

      {read.bullishSignals.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-black uppercase" style={{ color: GN.bull }}>Demand-positive headlines</p>
          {read.bullishSignals.map((h, i) => <p key={i} className="text-[9.5px] leading-snug" style={{ color: "var(--gn-muted)" }}>• {h}</p>)}
        </div>
      )}
      {read.bearishSignals.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[9px] font-black uppercase" style={{ color: GN.bear }}>Demand-negative headlines</p>
          {read.bearishSignals.map((h, i) => <p key={i} className="text-[9.5px] leading-snug" style={{ color: "var(--gn-muted)" }}>• {h}</p>)}
        </div>
      )}
      {read.degreeDayMentions.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[9px] font-black uppercase" style={{ color: "var(--gn-muted)" }}>Degree-day mentions</p>
          {read.degreeDayMentions.map((h, i) => <p key={i} className="text-[9.5px] leading-snug" style={{ color: "var(--gn-muted)" }}>• {h}</p>)}
        </div>
      )}

      <p className="text-[9px] leading-snug mt-2 pt-2 border-t" style={{ color: "var(--gn-faint)", borderColor: "var(--gn-border)" }}>
        <AlertTriangle size={9} className="inline mr-1" style={{ color: GN.warn }} />
        {read.note}
      </p>
    </Panel>
  );
}

// ---- EIA panels (spec sections 15 and 16) ----
export function EiaCard({ title, unitLabel, latestValue, priorValue, changeValue, direction, bias, note, available, error }: {
  title: string; unitLabel: string; latestValue: number | null; priorValue: number | null; changeValue: number | null;
  direction: string | null; bias: Bias; note: string; available: boolean; error?: string;
}) {
  const color = BIAS_COLOR[bias];
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
  return (
    <Panel className="px-3 py-2.5" tone={available ? `${color}44` : "var(--gn-border)"}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-black" style={{ color: "var(--gn-text)" }}>{title}</p>
        {available && <Chip color={color}>{BIAS_WORD[bias]}</Chip>}
      </div>
      {!available ? (
        <p className="text-[10px] leading-snug mt-1.5" style={{ color: GN.warn }}>
          {error ?? "EIA data is not available right now."} No figure is shown rather than an estimated one.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 mt-2">
            <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
              <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>Latest</p>
              <p className="text-[12px] font-black leading-tight" style={{ color: "var(--gn-text)" }}>{fmt(latestValue)}</p>
            </div>
            <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
              <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>Prior week</p>
              <p className="text-[12px] font-black leading-tight" style={{ color: "var(--gn-text)" }}>{fmt(priorValue)}</p>
            </div>
            <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
              <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>Change</p>
              <p className="text-[12px] font-black leading-tight" style={{ color }}>
                {changeValue === null ? "—" : `${changeValue >= 0 ? "+" : "−"}${Math.abs(changeValue).toLocaleString("en-US")}`}
              </p>
            </div>
          </div>
          <p className="text-[9.5px] mt-1.5" style={{ color: "var(--gn-muted)" }}>
            {direction ? `${direction.toUpperCase()} of ${Math.abs(changeValue ?? 0).toLocaleString("en-US")} ${unitLabel} vs the prior week.` : ""}
          </p>
        </>
      )}
      <p className="text-[9px] leading-snug mt-2 pt-2 border-t" style={{ color: "var(--gn-faint)", borderColor: "var(--gn-border)" }}>{note}</p>
    </Panel>
  );
}

// ---- Event timeline (spec section 22) ----
export function TimelineList({ items }: { items: GptNewsItem[] }) {
  if (items.length === 0) {
    return <p className="text-[10px]" style={{ color: "var(--gn-faint)" }}>No events yet today.</p>;
  }
  return (
    <div className="space-y-0">
      {items.map((i, idx) => (
        <div key={i.id} className="flex gap-2.5">
          <div className="flex flex-col items-center shrink-0 w-[52px]">
            <span className="text-[9.5px] font-black pt-[1px]" style={{ color: "var(--gn-muted)" }}>
              {new Date(i.publishedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
            </span>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <span className="w-2 h-2 rounded-full mt-[4px]" style={{ background: BIAS_COLOR[i.direction] }} />
            {idx < items.length - 1 && <span className="w-px flex-1" style={{ background: "var(--gn-border)" }} />}
          </div>
          <div className="pb-2.5 min-w-0">
            <p className="text-[10.5px] font-bold leading-snug" style={{ color: "var(--gn-text)" }}>{i.headline}</p>
            <p className="text-[9px] mt-0.5" style={{ color: BIAS_COLOR[i.direction] }}>
              {i.asset === "NG" ? "Gas" : i.asset === "BOTH" ? "Crude & Gas" : "Crude"}{" "}
              {i.direction === "neutral" ? "· no clear direction" : `${i.direction === "bearish" ? "−" : "+"}`.repeat(1) + (i.direction === "bearish" ? "−" : "+").repeat(Math.max(0, STRENGTH_MARKS[i.strength] - 1))}
              <span style={{ color: "var(--gn-faint)" }}> · {i.primarySource}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- GPT Market Intelligence (spec section 35) ----
export function IntelligenceCard({ block }: { block: IntelligenceBlock }) {
  return (
    <Panel className="px-3 py-2.5">
      <p className="text-[12px] font-black" style={{ color: "var(--gn-text)" }}>{block.headline}</p>

      <div className="mt-2">
        <Chip color={GN.bull}>Fact — reported</Chip>
        <ul className="mt-1 space-y-0.5">
          {block.facts.map((f, i) => (
            <li key={i} className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>{i + 1}. {f}</li>
          ))}
        </ul>
      </div>

      <div className="mt-2">
        <Chip color={GN.accent}>Interpretation</Chip>
        <p className="text-[10px] leading-snug mt-1" style={{ color: "var(--gn-muted)" }}>{block.interpretation}</p>
      </div>

      <div className="mt-2">
        <Chip color={GN.warn}>Counter-risks</Chip>
        <ul className="mt-1 space-y-0.5">
          {block.counterRisks.map((r, i) => (
            <li key={i} className="text-[10px] leading-snug" style={{ color: "var(--gn-muted)" }}>• {r}</li>
          ))}
        </ul>
      </div>

      <p className="text-[10px] leading-snug mt-2 pt-2 border-t font-bold" style={{ color: "var(--gn-text)", borderColor: "var(--gn-border)" }}>{block.conclusion}</p>
    </Panel>
  );
}

// ---- Upcoming events (spec section 26) ----
export function EventRow({ e }: { e: UpcomingEvent }) {
  const color = e.importance === "HIGH" ? GN.shock : e.importance === "MEDIUM" ? GN.warn : GN.flat;
  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-b-0" style={{ borderColor: "var(--gn-border)" }}>
      <span className="w-1 h-7 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className="text-[10.5px] font-bold truncate" style={{ color: "var(--gn-text)" }}>{e.name}</p>
        <p className="text-[9px]" style={{ color: "var(--gn-faint)" }}>{e.whenLabel} · {e.source}</p>
      </div>
      <Chip color={color}>{e.affects === "NG" ? "GAS" : e.affects}</Chip>
    </div>
  );
}

// ---- Positions (spec sections 8, 36, 37) ----

/** A stored position may carry a blank or unparseable expiry; say so rather than printing "Invalid Date". */
function expiryLabel(expiry: string): string {
  const d = new Date(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "not set";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function PositionCard({ read, onEdit, premiumNote }: { read: PositionRead; onEdit: () => void; premiumNote?: string }) {
  const { input } = read;
  const pnlColor = read.pnlRs === null ? GN.flat : read.pnlRs >= 0 ? GN.bull : GN.bear;
  const name = input.symbol === "CRUDEOIL" ? "Crude Oil" : "Natural Gas";
  const rs = (n: number) => `₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
  const num = (n: number | null, d = 2) => (n === null ? "—" : n.toFixed(d));

  return (
    <Panel className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-black" style={{ color: "var(--gn-text)" }}>
            {name} {input.strike} {input.optSide}
          </p>
          <p className="text-[9px]" style={{ color: "var(--gn-faint)" }}>
            Expiry {expiryLabel(input.expiry)} · {input.lots} lot{input.lots > 1 ? "s" : ""} · avg ₹{input.avgPremium.toFixed(2)}
          </p>
        </div>
        <button type="button" onClick={onEdit} className="text-[9.5px] font-black px-2 py-1 rounded-md shrink-0" style={{ background: "var(--gn-panel-2)", color: "var(--gn-muted)" }}>
          Edit
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mt-2">
        <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
          <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>Underlying</p>
          <p className="text-[12px] font-black leading-tight" style={{ color: "var(--gn-text)" }}>{read.underlying === null ? "—" : `₹${read.underlying.toLocaleString("en-IN")}`}</p>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
          <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>Premium now</p>
          <p className="text-[12px] font-black leading-tight" style={{ color: read.premium === null ? GN.warn : "var(--gn-text)" }}>{read.premium === null ? "—" : `₹${read.premium.toFixed(2)}`}</p>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--gn-panel-2)" }}>
          <p className="text-[8.5px] font-bold uppercase" style={{ color: "var(--gn-faint)" }}>P&L ({input.lots} lot{input.lots > 1 ? "s" : ""})</p>
          <p className="text-[12px] font-black leading-tight" style={{ color: pnlColor }}>
            {read.pnlRs === null ? "—" : `${read.pnlRs >= 0 ? "+" : "−"}${rs(read.pnlRs)}`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
        {[
          ["Break-even", `₹${read.breakeven.toFixed(2)}`],
          ["To break-even", read.distanceToBreakeven === null ? "—" : `${read.distanceToBreakeven >= 0 ? "+" : ""}${num(read.distanceToBreakeven)}`],
          ["To strike", read.distanceToStrike === null ? "—" : `${read.distanceToStrike >= 0 ? "+" : ""}${num(read.distanceToStrike)}`],
          ["Days to expiry", read.daysToExpiry === null ? "—" : String(read.daysToExpiry)],
          ["Intrinsic value", read.intrinsic === null ? "—" : `₹${num(read.intrinsic)}`],
          ["Time value", read.timeValue === null ? "—" : `₹${num(read.timeValue)}`],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className="text-[9.5px]" style={{ color: "var(--gn-faint)" }}>{k}</span>
            <span className="text-[10px] font-bold" style={{ color: "var(--gn-text)" }}>{v}</span>
          </div>
        ))}
      </div>

      {read.premium === null && premiumNote && (
        <p className="text-[9.5px] mt-1.5 leading-snug" style={{ color: GN.warn }}>{premiumNote}</p>
      )}

      {read.expiryWarning && read.daysToExpiry !== null && (
        <p className="text-[9.5px] mt-2 px-2 py-1.5 rounded-lg leading-snug" style={{ background: `${GN.warn}18`, color: GN.warn }}>
          <AlertTriangle size={9} className="inline mr-1" />
          {read.daysToExpiry} day{read.daysToExpiry === 1 ? "" : "s"} to expiry — time value drains fastest in the final days.
        </p>
      )}

      <p className="text-[9.5px] mt-2 leading-snug" style={{ color: "var(--gn-muted)" }}>
        <Radio size={9} className="inline mr-1" style={{ color: BIAS_COLOR[read.newsBias] }} />
        {read.newsNote}
      </p>

      {input.levels.length > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--gn-border)" }}>
          <p className="text-[9px] font-black uppercase mb-1" style={{ color: "var(--gn-muted)" }}>Your monitoring levels</p>
          <div className="space-y-0.5">
            {[...input.levels].sort((a, b) => a.price - b.price).map((l) => {
              const above = read.underlying !== null && read.underlying >= l.price;
              const color = read.underlying === null ? GN.flat : above ? GN.bull : GN.bear;
              return (
                <div key={`${l.price}-${l.label}`} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[10px] font-bold" style={{ color: "var(--gn-text)" }}>₹{l.price.toLocaleString("en-IN")}</span>
                  <span className="text-[9.5px]" style={{ color: "var(--gn-faint)" }}>{l.label}</span>
                  {read.underlying !== null && (
                    <span className="text-[9px] ml-auto" style={{ color }}>{above ? "above" : "below"}</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[9px] mt-1.5 leading-snug" style={{ color: "var(--gn-faint)" }}>
            These are your own monitoring levels, not predictions or targets. Nothing here guarantees the price will reach them.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ---- Source health (spec section 34) ----
export function SourceHealth({ sourceStatus, lastUpdateLabel }: { sourceStatus: { source: string; ok: boolean; count: number; error?: string }[]; lastUpdateLabel: string | null }) {
  const [open, setOpen] = useState(false);
  const okCount = sourceStatus.filter((s) => s.ok).length;
  return (
    <Panel className="px-3 py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="text-[11px] font-black" style={{ color: "var(--gn-text)" }}>
          Source status · {okCount}/{sourceStatus.length} live
        </span>
        <ChevronDown size={12} style={{ color: "var(--gn-muted)" }} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {lastUpdateLabel && <p className="text-[9px] text-left mt-0.5" style={{ color: "var(--gn-faint)" }}>{lastUpdateLabel}</p>}
      {open && (
        <div className="mt-2 space-y-1">
          {sourceStatus.length === 0 ? (
            <p className="text-[10px]" style={{ color: "var(--gn-faint)" }}>No source report in this response.</p>
          ) : (
            sourceStatus.map((s) => (
              <div key={s.source} className="flex items-center gap-1.5">
                {s.ok ? <CheckCircle2 size={11} style={{ color: GN.bull }} /> : <AlertTriangle size={11} style={{ color: GN.bear }} />}
                <span className="text-[10px] truncate flex-1" style={{ color: "var(--gn-muted)" }}>{s.source}</span>
                <span className="text-[9px]" style={{ color: "var(--gn-faint)" }}>{s.ok ? `${s.count} items` : s.error ?? "down"}</span>
              </div>
            ))
          )}
        </div>
      )}
    </Panel>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl px-4 py-6 text-center" style={{ background: "var(--gn-panel)", border: "1px solid var(--gn-border)" }}>
      <HelpCircle size={18} className="mx-auto mb-1.5" style={{ color: "var(--gn-faint)" }} />
      <p className="text-[11.5px] font-bold" style={{ color: "var(--gn-muted)" }}>{title}</p>
      <p className="text-[10px] mt-1 leading-snug" style={{ color: "var(--gn-faint)" }}>{detail}</p>
    </div>
  );
}

export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-16 rounded-xl motion-safe:animate-pulse" style={{ background: "var(--gn-panel-2)" }} />
      ))}
    </div>
  );
}

export function ClockNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-[9.5px] flex items-center gap-1" style={{ color: "var(--gn-faint)" }}>
      <Clock size={9} /> {children}
    </p>
  );
}

export { PRIORITY_NOTE };
