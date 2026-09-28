import { useState } from "react";
import { ChevronDown, Layers3 } from "lucide-react";
import type { DecisionResult, PillarView } from "../../utils/buyDecisionEngine";

const BULL = "#10B981";
const BEAR = "#E11D48";
const DOT = { bull: BULL, bear: BEAR, neutral: "#94A3B8" } as const;

function word(v: number, insufficient?: boolean, room?: boolean) {
  if (insufficient) return { text: "Not enough data", ink: "#94A3B8" };
  // Room is not a direction: it says which side has space to run.
  if (room) {
    if (v > 0.15) return { text: "More room for CE", ink: BULL };
    if (v < -0.15) return { text: "More room for PE", ink: BEAR };
    return { text: "Similar both ways", ink: "#64748B" };
  }
  if (v > 0.5) return { text: "Strongly up", ink: "#047857" };
  if (v > 0.15) return { text: "Up", ink: BULL };
  if (v < -0.5) return { text: "Strongly down", ink: "#BE123C" };
  if (v < -0.15) return { text: "Down", ink: BEAR };
  return { text: "Neutral", ink: "#64748B" };
}

function Row({ p }: { p: PillarView }) {
  const [open, setOpen] = useState(false);
  const w = word(p.vote, p.insufficient, p.key === "room");
  const half = Math.min(1, Math.abs(p.vote)) * 50;
  return (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-extrabold text-slate-800">
            {p.title} <span className="text-[9.5px] font-bold text-slate-400">· {p.weight}%</span>
          </p>
          <span className="text-[11px] font-black flex items-center gap-1" style={{ color: w.ink }}>
            {w.text}
            <ChevronDown size={13} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </div>
        {/* Centre-zero meter: sellers to the left, buyers to the right. */}
        <div className="relative h-2 rounded-full bg-slate-100 mt-1.5">
          <span className="absolute left-1/2 -top-[2px] w-[2px] h-3 bg-slate-300 rounded" />
          {!p.insufficient && (
            <span
              className="absolute top-0 h-2 rounded-full"
              style={
                p.vote >= 0
                  ? { left: "50%", width: `${half}%`, background: `linear-gradient(90deg,${BULL}88,${BULL})` }
                  : { right: "50%", width: `${half}%`, background: `linear-gradient(270deg,${BEAR}88,${BEAR})` }
              }
            />
          )}
        </div>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-0.5">
          {p.notes.map((n, i) => (
            <li key={i} className="text-[11px] text-slate-600 leading-snug flex gap-1.5">
              <span className="mt-[5px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: DOT[n.side] }} />
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceCard({ result }: { result: DecisionResult }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Layers3 size={16} className="text-indigo-500" />
        <p className="text-[12.5px] font-black text-slate-800">The evidence</p>
      </div>
      <p className="text-[10px] text-slate-500 mb-1">
        Six independent reads, each from finished candles. Sellers ← centre → buyers. Tap any row for the reasons.
      </p>
      {result.pillars.map((p) => (
        <Row key={p.key} p={p} />
      ))}
    </div>
  );
}
