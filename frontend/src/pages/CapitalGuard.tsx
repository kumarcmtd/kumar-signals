import { Shield } from "lucide-react";
import { GuardHero } from "../components/guard/GuardHero";
import { TodaysCallsCard } from "../components/guard/TodaysCallsCard";
import { SizeCalculator } from "../components/guard/SizeCalculator";
import { PositionsCard } from "../components/guard/PositionsCard";
import { ReviewCard } from "../components/guard/ReviewCard";
import { RulesCard } from "../components/guard/RulesCard";

// Capital Guard: HOW MUCH to trade and WHEN TO STOP. Signal pages (AI Verify
// Pro and the rest) answer what to buy; none of them can stop a small account
// being wiped out by size. This page is plain arithmetic on the owner's own
// numbers and the live option chain -- it predicts nothing.
export function CapitalGuard() {
  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center gap-2 px-1">
        <Shield size={20} className="text-indigo-600" />
        <div>
          <p className="text-[19px] font-black text-slate-800 leading-tight">Capital Guard</p>
          <p className="text-[11px] text-slate-500">Protect the capital first. Calls come second.</p>
        </div>
      </div>
      <GuardHero />
      <TodaysCallsCard />
      <SizeCalculator />
      <PositionsCard />
      <ReviewCard />
      <RulesCard />
      <p className="text-[10px] text-[var(--color-muted)] leading-relaxed text-center px-3">
        Educational tool, not financial advice. Settings and positions stay on this phone only. No page can predict price — size and stops are what you control.
      </p>
    </div>
  );
}
