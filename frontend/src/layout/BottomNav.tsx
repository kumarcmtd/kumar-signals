import { NavLink } from "react-router-dom";
import { Zap, LineChart, Brain, ListTree, Calculator, NotebookText, Settings, Gem, FlaskConical } from "lucide-react";

const items = [
  { to: "/", label: "AI Trade", icon: Zap, end: true },
  { to: "/charts", label: "Charts", icon: LineChart },
  { to: "/master-ai", label: "AI Analysis", icon: Brain },
  { to: "/options", label: "Options", icon: ListTree },
  { to: "/risk", label: "Risk", icon: Calculator },
  { to: "/journal", label: "Journal", icon: NotebookText },
  { to: "/ai-3v", label: "AI 3V", icon: Gem },
  { to: "/ai-test", label: "AI-Test", icon: FlaskConical },
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
              `flex flex-col items-center gap-0.5 py-2.5 px-1 text-[9px] leading-tight text-center font-medium transition-colors shrink-0 basis-1/6 min-w-[60px] ${
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
