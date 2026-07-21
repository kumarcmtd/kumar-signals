import { NavLink } from "react-router-dom";
import { Zap, LayoutGrid, LineChart, ListTree, Calculator, Globe2, Settings, Brain, Briefcase } from "lucide-react";

const items = [
  { to: "/", label: "Trade", icon: Zap, end: true },
  { to: "/master-ai", label: "Analysis", icon: Brain },
  { to: "/prices", label: "Prices", icon: LayoutGrid },
  { to: "/charts", label: "Charts", icon: LineChart },
  { to: "/options", label: "Options", icon: ListTree },
  { to: "/portfolio", label: "Portfolio", icon: Briefcase },
  { to: "/risk", label: "Risk", icon: Calculator },
  { to: "/global", label: "Global", icon: Globe2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[var(--color-border)]">
      <div className="max-w-lg mx-auto flex overflow-x-auto no-scrollbar">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 px-1 text-[10px] font-medium transition-colors shrink-0 basis-1/6 min-w-[58px] ${
                isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]"
              }`
            }
          >
            <Icon size={19} strokeWidth={2.2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
