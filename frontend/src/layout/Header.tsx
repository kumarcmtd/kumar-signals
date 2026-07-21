import { useMarketStatus } from "../api/hooks";

export function Header() {
  const { data: market } = useMarketStatus();

  return (
    <header className="safe-top sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-[var(--color-border)]">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold bg-gradient-to-r from-[var(--color-primary)] to-indigo-600 bg-clip-text text-transparent">
            Kumar Signals Pro
          </h1>
          <p className="text-[11px] text-[var(--color-muted)] -mt-0.5">MCX Crude Oil &amp; Natural Gas</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-[var(--color-surface-soft)] px-3 py-1.5 text-xs font-semibold">
          <span
            className={`h-2 w-2 rounded-full ${
              market?.isOpen ? "bg-[var(--color-buy)] shadow-[0_0_6px_var(--color-buy)]" : "bg-[var(--color-sell)]"
            }`}
          />
          <span>{market?.isOpen ? "LIVE" : "CLOSED"}</span>
          <span className="text-[var(--color-muted)] font-normal">{market?.timeLabel}</span>
        </div>
      </div>
    </header>
  );
}
