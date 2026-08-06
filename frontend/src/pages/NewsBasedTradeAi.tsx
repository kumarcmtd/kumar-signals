import { useState } from "react";
import { Radio, TrendingUp, TrendingDown } from "lucide-react";
import { useNewsTradeAI } from "../hooks/useNewsTradeAI";
import { useNewsTrade } from "../api/hooks";
import { NewsTradeDecisionCard } from "../components/NewsTradeDecisionCard";
import { NewsFeedList } from "../components/NewsFeedList";
import { EconCalendarCard } from "../components/EconCalendarCard";
import type { NewsTradeSymbol } from "../utils/newsTradeEngine";

const SYMBOLS: NewsTradeSymbol[] = ["CRUDEOIL", "NATURALGAS"];
const DISPLAY_NAME: Record<NewsTradeSymbol, string> = { CRUDEOIL: "Crude Oil", NATURALGAS: "Natural Gas" };

function SymbolBody({ symbol }: { symbol: NewsTradeSymbol }) {
  const { result, underlyingPrice, candlesLoading, candlesError } = useNewsTradeAI(symbol);

  if (candlesError) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: "#181A24", border: "1px solid rgba(255,77,79,.3)" }}>
        <p className="text-sm font-bold text-[#FF4D4F]">Live data unavailable</p>
        <p className="text-xs text-white/40 mt-1">{candlesError}</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
        <p className="text-sm font-bold text-white/70">{candlesLoading ? "Loading market data…" : "Gathering enough candles to compute the final decision…"}</p>
      </div>
    );
  }

  const Bias = underlyingPrice !== null && result.technical.net >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-3.5 flex items-center justify-between" style={{ background: "#181A24", border: "1px solid rgba(255,255,255,.08)" }}>
        <p className="text-sm font-black text-white/85 flex items-center gap-1.5">
          <Bias size={16} className={result.technical.net >= 0 ? "text-[#00E676]" : "text-[#FF4D4F]"} />
          {DISPLAY_NAME[symbol]}
        </p>
        {underlyingPrice !== null && <p className="text-xs font-bold text-white/50">₹{underlyingPrice.toFixed(2)}</p>}
      </div>
      <NewsTradeDecisionCard result={result} label={`${DISPLAY_NAME[symbol]} Final Decision`} />
    </div>
  );
}

export function NewsBasedTradeAi() {
  const [symbol, setSymbol] = useState<NewsTradeSymbol>("NATURALGAS");
  const { data: newsData } = useNewsTrade();

  return (
    <div className="-mx-4 -mt-4 px-4 pt-4 pb-6 min-h-screen text-white space-y-4" style={{ background: "linear-gradient(180deg,#09090F,#0D0E16 40%,#09090F)" }}>
      <section className="pt-2">
        <div className="flex items-center gap-2">
          <Radio size={20} className="text-[#00C2FF]" />
          <h1 className="text-xl font-black">News Based Trade AI</h1>
        </div>
        <p className="text-[11px] text-white/40 mt-1">
          Live energy news scored and combined with technicals, options, and liquidity -- News never generates a signal alone (30% weight, auto-redistributed when unavailable).
        </p>
      </section>

      <div className="flex gap-2">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            onClick={() => setSymbol(s)}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold border transition-colors"
            style={symbol === s ? { background: "linear-gradient(135deg,#00C2FF,#0080FF)", color: "#04121C", borderColor: "transparent" } : { background: "#181A24", borderColor: "rgba(255,255,255,.08)", color: "rgba(255,255,255,.5)" }}
          >
            {DISPLAY_NAME[s]}
          </button>
        ))}
      </div>

      <SymbolBody symbol={symbol} />

      <EconCalendarCard events={newsData?.calendar.events ?? []} available={newsData?.calendar.available ?? false} error={newsData?.calendar.error} />

      <NewsFeedList articles={newsData?.news.articles ?? []} available={newsData?.news.available ?? false} error={newsData?.news.error} />

      <p className="text-[10px] text-white/30 leading-relaxed text-center px-4 pb-2">
        Educational reference only, not financial advice. News scoring is rule-based (not an LLM classification), so the same headline always scores the same way. Always confirm on the live chart
        before acting.
      </p>
    </div>
  );
}
