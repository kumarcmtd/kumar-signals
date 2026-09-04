import { useMemo, useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useGlobalMarkets, useCandles } from "../api/hooks";
import { globalEnergyVenues, aggregateBias } from "../utils/globalMarketHours";
import { liveSidesForSymbol } from "../utils/signalConflict";
import { computeConsensus, type ConsensusLight, type ConsensusRead } from "../utils/tradeConsensus";
import { atr } from "../utils/indicators";
import type { GlobalQuote } from "../types";

const SYMBOLS = ["CRUDEOIL", "NATURALGAS"] as const;
const DISPLAY_NAME: Record<string, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

const LIGHT: Record<ConsensusLight, { color: string; soft: string; word: string }> = {
  green: { color: "#16A34A", soft: "#16A34A14", word: "GO" },
  yellow: { color: "#CA8A04", soft: "#CA8A0414", word: "WAIT" },
  red: { color: "#DC2626", soft: "#DC262614", word: "AVOID" },
};

function LightRow({ symbol, read }: { symbol: string; read: ConsensusRead }) {
  const l = LIGHT[read.light];
  const Arrow = read.side === "CE" ? TrendingUp : read.side === "PE" ? TrendingDown : Minus;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: `2px solid ${l.color}`, background: l.soft }}>
      <div className="flex items-stretch">
        {/* the light itself */}
        <div className="flex flex-col items-center justify-center px-3.5 py-3 gap-1" style={{ background: l.color }}>
          <span className="w-6 h-6 rounded-full bg-white/95 flex items-center justify-center">
            <Arrow size={15} style={{ color: l.color }} />
          </span>
          <span className="text-[9px] font-black text-white tracking-wide">{l.word}</span>
        </div>
        <div className="flex-1 px-3 py-2.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-black">{DISPLAY_NAME[symbol] ?? symbol}</p>
            <span className="text-[11px] font-black shrink-0" style={{ color: l.color }}>
              {read.headline}
            </span>
          </div>
          <p className="text-[11px] text-slate-600 leading-snug mt-0.5">{read.detail}</p>
        </div>
      </div>
    </div>
  );
}

// The at-a-glance "is it worth digging into the pages?" summary for Crude and
// NG. Aggregates every page's live calls + the overnight global lean + live
// volatility into one traffic light per symbol.
export function TradeConsensusLights() {
  const tradeLogs = useAppStore((s) => s.tradeLogs);
  const { data: quotes } = useGlobalMarkets();
  const crude15 = useCandles("CRUDEOIL", "15");
  const ng15 = useCandles("NATURALGAS", "15");

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const reads = useMemo(() => {
    const venues = globalEnergyVenues(now);
    const quoteBySymbol = new Map<string, GlobalQuote>();
    for (const q of quotes ?? []) quoteBySymbol.set(q.symbol, q);
    const leanFor = (sym: "CRUDEOIL" | "NATURALGAS") => {
      const changes = venues.filter((v) => v.tracksMcx === sym && v.quoteSymbol).map((v) => quoteBySymbol.get(v.quoteSymbol!)?.changePercent ?? null);
      const b = aggregateBias(changes);
      return b.avgPct === null ? null : b.dir;
    };
    const volFor = (candles: { close: number }[] | undefined) => {
      if (!candles || candles.length < 20) return null;
      const a = atr(candles as never, 14);
      const last = candles[candles.length - 1].close;
      return a !== null && last > 0 ? (a / last) * 100 : null;
    };

    return SYMBOLS.map((symbol) => {
      const sides = liveSidesForSymbol(tradeLogs, symbol);
      const candles = symbol === "CRUDEOIL" ? crude15.data?.candles : ng15.data?.candles;
      const read = computeConsensus({
        symbolName: DISPLAY_NAME[symbol],
        cePages: sides.ce.map((s) => s.page),
        pePages: sides.pe.map((s) => s.page),
        overnightLean: leanFor(symbol),
        volatilityPct: volFor(candles),
      });
      return { symbol, read };
    });
  }, [tradeLogs, quotes, crude15.data, ng15.data, now]);

  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2 px-0.5">Quick Read — Trade or Wait?</p>
      <div className="space-y-2">
        {reads.map(({ symbol, read }) => (
          <LightRow key={symbol} symbol={symbol} read={read} />
        ))}
      </div>
      <p className="text-[9px] text-slate-400 mt-2 px-0.5 leading-snug">
        A one-glance summary of every page's live calls + the overnight global lean + volatility. 🟢 clear side to look at · 🟡 mixed, premiums burn · 🔴 split or too wild. A starting read, not a trade — open the pages before acting.
      </p>
    </div>
  );
}
