import { CalendarClock } from "lucide-react";
import type { EconCalendarEvent } from "../types";

function daysUntil(dateStr: string): string {
  const diff = Math.round((new Date(`${dateStr}T00:00:00`).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 0) return dateStr;
  return `in ${diff}d`;
}

export function EconCalendarCard({ events, available, error }: { events: EconCalendarEvent[]; available: boolean; error?: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
      <p className="text-xs font-black uppercase text-white/60 mb-3 flex items-center gap-1.5">
        <CalendarClock size={13} /> Event Calendar
      </p>
      {!available ? (
        <p className="text-[11px] text-white/40 leading-relaxed">
          {error === "FRED_API_KEY not configured" ? "Calendar isn't connected yet -- add a FRED_API_KEY secret to light this up." : (error ?? "Calendar unavailable right now.")}
        </p>
      ) : events.length === 0 ? (
        <p className="text-[11px] text-white/40">No upcoming releases found.</p>
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.name} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "#12131C" }}>
              <span className="text-[11px] font-bold text-white/80">{e.name}</span>
              <span className="text-[10px] font-black text-[#00C2FF]">{daysUntil(e.date)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
