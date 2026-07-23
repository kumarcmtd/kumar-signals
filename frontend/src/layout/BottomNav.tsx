import { NavLink } from "react-router-dom";
import { FlaskConical, Crown, ShieldCheck, BarChart3, BookOpen, LineChart, ListTree, Calculator, NotebookText, Bell, Settings } from "lucide-react";
import { useAppStore } from "../store/appStore";

const items = [
  { to: "/", label: "AI-Test V2", icon: FlaskConical, end: true },
  { to: "/ai-test-pro", label: "AI-Test Pro", icon: Crown },
  { to: "/ai-elite", label: "AI Elite", icon: ShieldCheck },
  { to: "/trade-report", label: "Trade Report", icon: BarChart3 },
  { to: "/kimi-ai-trade", label: "Kimi AI", icon: BookOpen },
  { to: "/charts", label: "Charts", icon: LineChart },
  { to: "/options", label: "Options", icon: ListTree },
  { to: "/risk", label: "Risk", icon: Calculator },
  { to: "/journal", label: "Journal", icon: NotebookText },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
  const unreadCount = useAppStore((s) => s.alerts.filter((a) => !a.read).length);

  return (
    <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[var(--color-border)]">
      <div className="max-w-lg mx-auto flex overflow-x-auto no-scrollbar">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex flex-col items-center gap-0.5 py-2.5 px-1 text-[9px] leading-tight text-center font-medium transition-colors shrink-0 basis-1/6 min-w-[60px] ${
                isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]"
              }`
            }
          >
            <span className="relative">
              <Icon size={19} strokeWidth={2.2} />
              {to === "/alerts" && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[var(--color-sell)] text-white text-[8px] font-bold flex items-center justify-center leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
