import { usePrices, useSignals, useMarketStatus } from "../api/hooks";
import { PriceCardTile } from "../components/PriceCardTile";
import { SignalCardTile } from "../components/SignalCardTile";
import { CardSkeleton } from "../components/Skeleton";

export function Dashboard() {
  const { data: market } = useMarketStatus();
  const { data: prices, isLoading: pricesLoading, error: pricesError } = usePrices();
  const { data: signals, isLoading: signalsLoading, error: signalsError } = useSignals();

  const liveSignals = signals?.filter((s) => !s.error && s.trade.action !== "NO TRADE").length ?? 0;

  return (
    <div className="space-y-6">
      {!market?.isOpen && (
        <div className="rounded-xl bg-[var(--color-warn-soft)] border border-amber-300 text-amber-800 text-xs px-4 py-3">
          Market closed — showing last cached data. {market?.mcxStatus}
        </div>
      )}

      <section className="grid grid-cols-4 gap-2">
        <QuickStat label="Signals Live" value={String(liveSignals)} />
        <QuickStat label="Trend" value={market?.isOpen ? "Active" : "—"} />
        <QuickStat label="Volatility" value="—" />
        <QuickStat label="Risk" value="Moderate" />
      </section>

      <section>
        <SectionTitle>Live Prices</SectionTitle>
        <div className="grid grid-cols-1 gap-3">
          {pricesLoading && (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          )}
          {pricesError && <ErrorNote message={(pricesError as Error).message} />}
          {prices?.map((p) => (
            <PriceCardTile key={p.symbol} card={p} />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>AI Signals</SectionTitle>
        <div className="grid grid-cols-1 gap-3">
          {signalsLoading && (
            <>
              <CardSkeleton />
              <CardSkeleton />
            </>
          )}
          {signalsError && <ErrorNote message={(signalsError as Error).message} />}
          {signals?.map((s) => (
            <SignalCardTile key={s.symbol} signal={s} />
          ))}
        </div>
      </section>

      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed px-1">
        Educational reference only, not financial advice. Signals combine algorithmic chart-pattern detection with
        option-chain OI/PCR bias; always verify on the live chart and manage your own risk before trading.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)] mb-2 px-1">{children}</h2>;
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-tile px-2 py-3 text-center">
      <p className="text-sm font-bold">{value}</p>
      <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{label}</p>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <div className="card p-4 text-sm text-[var(--color-sell)]">{message}</div>;
}
