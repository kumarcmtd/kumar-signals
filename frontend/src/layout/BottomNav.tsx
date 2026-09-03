import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Rocket, Crosshair, Target, Waypoints, Menu, X,
  BadgeCheck, Radio,
  ClipboardCheck, Flame, Zap, FlaskConical, Crown, ShieldCheck, BookOpen, BrainCircuit, Cpu, TrendingUp, TrendingDown,
  LineChart, Layers, Activity, Calculator, Globe, NotebookText, Bell,
  GraduationCap, BarChart3, Settings, Sparkles, Repeat,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "../store/appStore";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

// The four hero signals live directly in the bottom bar; everything else is
// one tap away under "More", grouped by what it's for. Nothing was removed --
// this replaces a flat, horizontally-scrolling strip of 24 equally-weighted
// icons (where reaching Journal or Settings meant scrolling past ~20 signal
// pages) with a clear hierarchy.
const PRIMARY: NavItem[] = [
  { to: "/", label: "AI-Shoot", icon: Rocket, end: true },
  { to: "/best-call", label: "Best Call", icon: Crosshair },
  { to: "/ai-20-20", label: "Ai20-20", icon: Target },
  { to: "/level-cross-scan", label: "Level Cross", icon: Waypoints },
];

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Signals",
    items: [
      { to: "/ai-up", label: "AI-Up", icon: Repeat },
      { to: "/ai-own", label: "AI Own", icon: Sparkles },
      { to: "/ai-verify-pro", label: "Verify Pro", icon: BadgeCheck },
      { to: "/news-trade-ai", label: "News AI", icon: Radio },
    ],
  },
  {
    title: "More Engines",
    items: [
      { to: "/ai-strategy-verification", label: "AI Verify", icon: ClipboardCheck },
      { to: "/ai-risk", label: "AI-Risk", icon: Flame },
      { to: "/ai-supertrend-pro", label: "SuperTrend Pro", icon: Zap },
      { to: "/ai-test-v2", label: "AI-Test V2", icon: FlaskConical },
      { to: "/ai-test-pro", label: "AI-Test Pro", icon: Crown },
      { to: "/ai-elite", label: "AI Elite", icon: ShieldCheck },
      { to: "/kimi-ai-trade", label: "Kimi AI", icon: BookOpen },
      { to: "/market-analysis", label: "Market Analysis", icon: BrainCircuit },
      { to: "/kumar-ai", label: "Kumar AI", icon: Cpu },
      { to: "/ce-buy-signals", label: "CE Buy", icon: TrendingUp },
      { to: "/pe-buy-signals", label: "PE Buy", icon: TrendingDown },
    ],
  },
  {
    title: "Tools",
    items: [
      { to: "/charts", label: "Charts", icon: LineChart },
      { to: "/options", label: "Options", icon: Layers },
      { to: "/prices", label: "Live Prices", icon: Activity },
      { to: "/risk", label: "Risk Calculator", icon: Calculator },
      { to: "/global", label: "Global Markets", icon: Globe },
      { to: "/journal", label: "Journal", icon: NotebookText },
      { to: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    title: "Learn & Reports",
    items: [
      { to: "/ai-learn", label: "AI-Learn", icon: GraduationCap },
      { to: "/trade-report", label: "Trade Report", icon: BarChart3 },
    ],
  },
  {
    title: "Account",
    items: [{ to: "/settings", label: "Settings", icon: Settings }],
  },
];

const PRIMARY_PATHS = new Set(PRIMARY.map((p) => p.to));

function MoreMenu({ open, onClose, unreadCount }: { open: boolean; onClose: () => void; unreadCount: number }) {
  const location = useLocation();

  // Close whenever the route changes (i.e. the user tapped an item).
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="More pages">
      <div className="absolute inset-0 bg-black/40 animate-[fadeIn_.15s_ease]" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto max-h-[82vh] overflow-y-auto rounded-t-2xl bg-[var(--color-surface)] border-t border-[var(--color-border)] shadow-2xl motion-safe:animate-[slideUp_.2s_cubic-bezier(.34,1.4,.64,1)]">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          <p className="text-sm font-bold">All Pages</p>
          <button onClick={onClose} aria-label="Close menu" className="p-1.5 rounded-lg text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]">
            <X size={18} />
          </button>
        </div>

        <div className="px-3 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)] px-2 mb-1.5">{group.title}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `relative flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 px-1 text-[11px] font-medium text-center leading-tight border transition-colors ${
                        isActive
                          ? "border-transparent text-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]"
                          : "border-[var(--color-border)] text-[var(--color-ink)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-soft)]"
                      }`
                    }
                  >
                    <span className="relative">
                      <Icon size={20} strokeWidth={2.1} />
                      {to === "/alerts" && unreadCount > 0 && (
                        <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-[3px] rounded-full bg-[var(--color-sell)] text-white text-[8px] font-bold flex items-center justify-center leading-none">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </span>
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
}

export function BottomNav() {
  const unreadCount = useAppStore((s) => s.alerts.filter((a) => !a.read).length);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const onSecondaryPage = !PRIMARY_PATHS.has(location.pathname);

  const tabClass = (active: boolean) =>
    `relative flex flex-col items-center gap-0.5 py-2.5 px-1 text-[10px] leading-tight text-center font-medium transition-colors flex-1 min-w-0 ${
      active ? "text-[var(--color-primary)]" : "text-[var(--color-muted)]"
    }`;

  return (
    <>
      <MoreMenu open={menuOpen} onClose={() => setMenuOpen(false)} unreadCount={unreadCount} />
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[var(--color-border)]">
        <div className="max-w-lg mx-auto flex">
          {PRIMARY.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => tabClass(isActive)}>
              <Icon size={21} strokeWidth={2.2} />
              {label}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMenuOpen(true)} className={tabClass(onSecondaryPage || menuOpen)} aria-label="More pages" aria-expanded={menuOpen}>
            <span className="relative">
              <Menu size={21} strokeWidth={2.2} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[var(--color-sell)] text-white text-[8px] font-bold flex items-center justify-center leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            More
          </button>
        </div>
      </nav>
    </>
  );
}
