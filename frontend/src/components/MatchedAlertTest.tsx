// Two ways to try the MATCHED alert: a sample push in the exact real format
// (marked TEST), and the real check run on live data now, with one line per
// market saying why it did or did not match.

import { BellRing, Search } from "lucide-react";
import { useCheckMatchedNow, useSendTestMatched } from "../api/hooks";

export function MatchedAlertTest({ hasTopic }: { hasTopic: boolean }) {
  const sample = useSendTestMatched();
  const check = useCheckMatchedNow();
  return (
    <div className="rounded-xl p-3 space-y-2 bg-emerald-50 border border-emerald-200">
      <p className="text-[12px] font-black text-emerald-800">Test the MATCHED alert</p>
      <p className="text-[10.5px] text-slate-600 leading-snug">
        A MATCHED push comes only when an Ai20-20 call and AI Verify Pro's confirmed BUY agree on the same side, and the live candle is not turning against it.
      </p>
      <button
        disabled={!hasTopic || sample.isPending}
        onClick={() => sample.mutate()}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-lg text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg,#059669,#10B981)" }}
      >
        <BellRing size={13} /> {sample.isPending ? "Sending…" : "Send test MATCHED alert (sample)"}
      </button>
      {sample.isSuccess && <p className="text-[11px] font-bold text-emerald-700">Sent — a push titled "TEST — MATCHED: Crude Oil 8850 CE" should ring now. Its numbers are samples.</p>}
      {sample.isError && <p className="text-[11px] font-bold text-rose-700">{(sample.error as Error).message}</p>}

      <button
        disabled={!hasTopic || check.isPending}
        onClick={() => check.mutate()}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-lg bg-white border border-emerald-300 text-emerald-800 disabled:opacity-40"
      >
        <Search size={13} /> {check.isPending ? "Checking live data…" : "Check for a MATCHED call now (live)"}
      </button>
      {check.isSuccess && (
        <ul className="space-y-1">
          {check.data.report.map((line) => (
            <li key={line} className="text-[11px] text-slate-700 leading-snug">• {line}</li>
          ))}
        </ul>
      )}
      {check.isError && <p className="text-[11px] font-bold text-rose-700">{(check.error as Error).message}</p>}
      {!hasTopic && <p className="text-[10.5px] font-bold text-rose-700">Save your ntfy topic above first.</p>}
    </div>
  );
}
