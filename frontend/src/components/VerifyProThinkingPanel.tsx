import { useState } from "react";
import { ChevronDown, Brain } from "lucide-react";
import type { ThinkingStep } from "../utils/verifyProEngine";

export function VerifyProThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between">
        <p className="text-xs font-black uppercase text-[var(--color-muted)] flex items-center gap-1.5">
          <Brain size={13} />
          AI Thinking Panel
        </p>
        <ChevronDown size={16} className={`text-[var(--color-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          {steps.map((s) => (
            <div key={s.step} className="flex gap-2.5">
              <div
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black"
                style={{ background: "var(--color-primary)", color: "#fff" }}
              >
                {s.step}
              </div>
              <div className="min-w-0">
                <p className="text-[11.5px] font-bold">{s.title}</p>
                <p className="text-[11px] text-[var(--color-muted)] leading-snug">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
