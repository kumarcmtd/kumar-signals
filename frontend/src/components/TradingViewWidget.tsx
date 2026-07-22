import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    TradingView?: any;
  }
}

let tvScriptPromise: Promise<void> | null = null;
function loadTradingViewScript(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  if (!tvScriptPromise) {
    tvScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load TradingView's chart script"));
      document.head.appendChild(script);
    });
  }
  return tvScriptPromise;
}

// TradingView's public widget covers MCX continuous futures (e.g.
// MCX:CRUDEOIL1!, MCX:NATURALGAS1!) on their own charting infra -- separate
// from this app's Upstox-backed data. It's a locked iframe: there is no API
// to draw our own entry/stop/target lines on top of it, so this is for
// familiar market context only (see TradeChart.tsx for the annotated,
// self-drawn version). Mount with a `key` prop that changes with the symbol
// so React fully remounts instead of stacking widgets in the same div.
export function TradingViewWidget({ symbol, interval = "15", height = 260 }: { symbol: string; interval?: string; height?: number }) {
  const containerId = useRef(`tv_${Math.random().toString(36).slice(2)}`).current;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTradingViewScript()
      .then(() => {
        if (cancelled || !window.TradingView) {
          if (!cancelled) setFailed(true);
          return;
        }
        new window.TradingView.widget({
          autosize: true,
          symbol,
          interval,
          timezone: "Asia/Kolkata",
          theme: "dark",
          style: "1",
          locale: "en",
          toolbar_bg: "#0B0F17",
          enable_publishing: false,
          hide_top_toolbar: false,
          hide_legend: true,
          withdateranges: false,
          studies: ["MAExp@tv-basicstudies", "VWAP@tv-basicstudies"],
          container_id: containerId,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval, containerId]);

  if (failed) {
    return (
      <div className="rounded-2xl bg-[#181A24] border border-white/10 p-6 text-center text-sm text-[#9AA4B2]">
        Chart widget unavailable right now (TradingView's script didn't load or doesn't recognize this symbol).
      </div>
    );
  }

  return <div id={containerId} className="w-full rounded-2xl overflow-hidden border border-white/10" style={{ height }} />;
}
