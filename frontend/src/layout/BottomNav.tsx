import { NavLink } from "react-router-dom";
import { LayoutGrid, LineChart, ListTree, Calculator, Globe2, Settings, Brain } from "lucide-react";

const items = [
  { to: "/", label: "Home", icon: LayoutGrid, end: true },
  { to: "/master-ai", label: "AI", icon: Brain },
  { to: "/charts", label: "Charts", icon: LineChart },
  { to: "/options", label: "Options", icon: ListTree },
  { to: "/risk", label: "Risk", icon: Calculator },
  { to: "/global", label: "Global", icon: Globe2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[var(--color-border)]">
      <div className="max-w-lg mx-auto grid grid-cols-7">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
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
