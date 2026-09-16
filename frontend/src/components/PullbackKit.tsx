// Pullback vs Reversal -- the shared UI.
//
// PullbackStatusCard is the compact version that sits on the six main tabs.
// Everything else here is for the AI Pullback page itself. Both read the SAME
// engine result, fetched once and shared by query key, so the card on AI-Shoot
// and the page can never disagree about the state.
//
// Light UI on purpose (spec Part 51: "Do NOT make the feature dark-only"), with
// soft green / red / yellow backgrounds and a large readable status.

import { useState, type ReactNode } from "react";
import { ChevronDown, TrendingUp, TrendingDown, AlertTriangle, ShieldQuestion, ArrowRight } from "lucide-react";
import type { PullbackResult, PullbackState, StructureHealth, TfStructure, Zone, ZoneState } from "../utils/pullbackReversalEngine";
import { TF_ORDER } from "../utils/pullbackReversalEngine";

export const STATE_STYLE: Record<PullbackState, { ink: string; soft: string; edge: string; Icon: typeof TrendingUp }> = {
  still_bullish: { ink: "#15803D", soft: "#F0FDF4", edge: "#86EFAC", Icon: TrendingUp },
  bearish: { ink: "#B91C1C", soft: "#FEF2F2", edge: "#FCA5A5", Icon: TrendingDown },
  uncertain: { ink: "#B45309", soft: "#FFFBEB", edge: "#FCD34D", Icon: ShieldQuestion },
};

const HEALTH_WORD: Record<StructureHealth, string> = {
  intact: "Intact",
  weakening: "Weakening",
  broken: "Broken",
  unknown: "No data",
};

const HEALTH_INK: Record<StructureHealth, string> = {
  intact: "#15803D",
  weakening: "#B45309",
  broken: "#B91C1C",
  unknown: "#94A3B8",
};

const ZONE_WORD: Record<ZoneState, string> = {
  holding: "Holding",
  testing: "Being tested",
  rejected: "Wicked through, recovered",
  broken: "Broken",
  reclaimed: "Reclaimed",
  retesting: "Retesting",
  failed_retest: "Failed retest",
  unknown: "Unknown",
};

const num = (n: number | null | undefined, d = 2) => (typeof n === "number" && Number.isFinite(n) ? n.toFixed(d) : "—");

/**
 * The compact status shown on the main tabs. Tapping it opens the full page --
 * this deliberately shows the answer and the three numbers a trader acts on,
 * and nothing else.
 */
export function PullbackStatusCard({ result, onOpen, loading, error }: {
  result: PullbackResult | undefined;
  onOpen?: () => void;
  loading?: boolean;
  error?: string | null;
}) {
  if (loading && !result) {
    return <div className="rounded-2xl h-[92px] bg-slate-100 motion-safe:animate-pulse" />;
  }
  if (error && !result) {
    return (
      <div className="rounded-2xl px-3 py-2.5 bg-amber-50 border border-amber-200">
        <p className="text-[11px] font-bold text-amber-700">Pullback read unavailable</p>
        <p className="text-[10px] text-amber-700/80 mt-0.5 leading-snug">{error}</p>
      </div>
    );
  }
  if (!result) return null;

  const s = STATE_STYLE[result.state];
  const { Icon } = s;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className="w-full text-left rounded-2xl overflow-hidden transition-transform active:scale-[.99] disabled:active:scale-100"
      style={{ background: s.soft, border: `1.5px solid ${s.edge}` }}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon size={18} style={{ color: s.ink }} strokeWidth={2.4} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-black leading-tight" style={{ color: s.ink }}>
              {result.stateLabel}
            </p>
            <p className="text-[10.5px] font-bold leading-tight" style={{ color: s.ink, opacity: 0.85 }}>
              {result.stateDetail} · {result.confidence}% model confidence
            </p>
          </div>
          {onOpen && <ArrowRight size={15} style={{ color: s.ink, opacity: 0.6 }} className="shrink-0" />}
        </div>

        <div className="grid grid-cols-3 gap-1.5 mt-2">
          {[
            ["Price", result.currentPrice === null ? "—" : num(result.currentPrice)],
            ["Support", result.nearestSupport ? `${num(result.nearestSupport.low)}–${num(result.nearestSupport.high)}` : "—"],
            ["Resistance", result.nearestResistance ? `${num(result.nearestResistance.low)}–${num(result.nearestResistance.high)}` : "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/70 px-2 py-1">
              <p className="text-[8.5px] font-bold uppercase text-slate-400">{k}</p>
              <p className="text-[11px] font-black text-slate-700 leading-tight tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        <p className="text-[9.5px] mt-1.5 leading-snug" style={{ color: s.ink, opacity: 0.75 }}>
          Invalidation: {result.invalidation}
        </p>
      </div>
    </button>
  );
}

// ---- Pieces for the full page ----

export function StateBanner({ result }: { result: PullbackResult }) {
  const s = STATE_STYLE[result.state];
  const { Icon } = s;
  return (
    <div className="rounded-2xl px-4 py-4" style={{ background: s.soft, border: `1.5px solid ${s.edge}` }}>
      <div className="flex items-start gap-3">
        <Icon size={26} style={{ color: s.ink }} strokeWidth={2.3} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[22px] font-black leading-none" style={{ color: s.ink }}>{result.stateLabel}</p>
          <p className="text-[13px] font-bold mt-1" style={{ color: s.ink, opacity: 0.9 }}>{result.stateDetail}</p>
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className="text-[9px] font-bold uppercase text-slate-500">Model confidence</p>
          <p className="text-[24px] font-black leading-none" style={{ color: s.ink }}>{result.confidence}%</p>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <div className="flex-1 rounded-xl bg-white/70 px-2.5 py-2">
          <p className="text-[9px] font-bold uppercase text-slate-400">Pullback case</p>
          <p className="text-[16px] font-black text-emerald-700 leading-tight">{result.pullbackProbability}%</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/70 px-2.5 py-2">
          <p className="text-[9px] font-bold uppercase text-slate-400">Reversal case</p>
          <p className="text-[16px] font-black text-red-700 leading-tight">{result.reversalProbability}%</p>
        </div>
        <div className="flex-1 rounded-xl bg-white/70 px-2.5 py-2">
          <p className="text-[9px] font-bold uppercase text-slate-400">The fall</p>
          <p className="text-[12px] font-black text-slate-700 leading-tight mt-0.5">{result.fall.label}</p>
        </div>
      </div>

      <p className="text-[10px] text-slate-500 leading-snug mt-2">
        This is a read on current conditions, not a forecast. It says which case the evidence currently favours and what would prove it wrong — never what price will do.
      </p>
    </div>
  );
}

export function StructureTable({ structures }: { structures: Record<string, TfStructure> }) {
  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] overflow-hidden">
      {TF_ORDER.map((tf) => {
        const s = structures[tf];
        if (!s) return null;
        return (
          <div key={tf} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-slate-100">
            <span className="text-[12px] font-black text-slate-700 w-[38px] shrink-0">{s.label}</span>
            {!s.available ? (
              <span className="text-[10.5px] text-slate-400">Not enough bars — left out of the score</span>
            ) : (
              <>
                <span className="text-[10.5px] font-bold" style={{ color: HEALTH_INK[s.health] }}>{HEALTH_WORD[s.health]}</span>
                {s.swingLabel && <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md bg-slate-100 text-slate-600">{s.swingLabel}</span>}
                {s.changeOfCharacter && <span className="text-[9px] font-black px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-700">Character change</span>}
                <span className="ml-auto text-[9.5px] text-slate-400 shrink-0 tabular-nums">{s.effectiveWeight.toFixed(0)}% weight</span>
              </>
            )}
          </div>
        );
      })}
      <p className="px-3 py-2 text-[9.5px] text-slate-400 leading-snug bg-slate-50">
        4H sets the structure, 1H confirms it, 30M confirms the developing move and 15M is timing. Weights are shared out over whichever timeframes actually have data.
      </p>
    </div>
  );
}

export function ZoneRow({ zone, price }: { zone: Zone; price: number | null }) {
  const isSupport = zone.kind === "support";
  const ink = zone.state === "broken" || zone.state === "failed_retest" ? "#B91C1C" : zone.state === "holding" || zone.state === "reclaimed" ? "#15803D" : "#B45309";
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-slate-100">
      <span className="w-1.5 h-8 rounded-full shrink-0" style={{ background: ink }} />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-black text-slate-800 tabular-nums">{num(zone.low)} – {num(zone.high)}</p>
        <p className="text-[9px] text-slate-400 truncate">{zone.sources.slice(0, 3).join(" · ")}{zone.sources.length > 3 ? ` +${zone.sources.length - 3}` : ""}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] font-bold" style={{ color: ink }}>{ZONE_WORD[zone.state]}</p>
        <p className="text-[9px] text-slate-400 tabular-nums">
          {zone.distancePct === null ? "—" : `${zone.distancePct > 0 ? "+" : ""}${zone.distancePct.toFixed(2)}%`}
          {price !== null && ` · ${isSupport ? "below" : "above"}`}
        </p>
      </div>
    </div>
  );
}

export function WhyPanel({ result }: { result: PullbackResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] px-3 py-2.5">
      <p className="text-[11px] font-black text-slate-700 mb-1.5">Why this reading?</p>
      {result.reasons.length === 0 && result.warnings.length === 0 && (
        <p className="text-[10.5px] text-slate-400">Nothing scored either way — there is not enough data to explain a call.</p>
      )}
      {result.reasons.map((r, i) => (
        <p key={`r${i}`} className="text-[10.5px] text-slate-600 leading-snug flex gap-1.5 mb-1">
          <span className="text-emerald-600 shrink-0">✓</span>{r}
        </p>
      ))}
      {result.warnings.map((w, i) => (
        <p key={`w${i}`} className="text-[10.5px] text-slate-600 leading-snug flex gap-1.5 mb-1">
          <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />{w}
        </p>
      ))}

      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 flex items-center gap-1 text-[9.5px] font-bold text-slate-400">
        {open ? "Hide the score breakdown" : "Show the score breakdown"}
        <ChevronDown size={10} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="mt-1.5 rounded-xl bg-slate-50 px-2.5 py-2">
          {result.contributions.map((c, i) => (
            <div key={i} className="flex items-baseline gap-2 py-[2px]">
              <span className="text-[10px] font-bold tabular-nums w-[34px] shrink-0" style={{ color: c.points >= 0 ? "#15803D" : "#B91C1C" }}>
                {c.points >= 0 ? "+" : ""}{c.points}
              </span>
              <span className="text-[10px] text-slate-600 leading-snug">{c.label} — {c.detail}</span>
            </div>
          ))}
          <div className="flex gap-3 mt-2 pt-2 border-t border-slate-200">
            <span className="text-[10px] font-black text-emerald-700">Bullish {result.bullishPullbackScore}</span>
            <span className="text-[10px] font-black text-red-700">Bearish {result.bearishReversalScore}</span>
            <span className="text-[10px] font-bold text-slate-500 ml-auto">Data quality {result.dataQuality}/10</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function LevelsPanel({ result }: { result: PullbackResult }) {
  const rows: [string, string][] = [
    ["Bullish confirmation", result.bullishConfirmation],
    ["Bearish confirmation", result.bearishConfirmation],
    ["What would prove this wrong", result.invalidation],
  ];
  return (
    <div className="rounded-2xl bg-white border border-[var(--color-border)] divide-y divide-slate-100">
      {rows.map(([k, v]) => (
        <div key={k} className="px-3 py-2">
          <p className="text-[9px] font-bold uppercase text-slate-400">{k}</p>
          <p className="text-[10.5px] text-slate-600 leading-snug mt-0.5">{v}</p>
        </div>
      ))}
    </div>
  );
}

export function SectionLabel({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-[13px] font-black text-slate-800">{children}</h2>
      {note && <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{note}</p>}
    </div>
  );
}
