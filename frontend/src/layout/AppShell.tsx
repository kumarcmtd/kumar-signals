import type { ReactNode } from "react";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";
import { useAlertEngine } from "../hooks/useAlertEngine";
import { useKeepScreenOn } from "../hooks/useKeepScreenOn";
import { useAppStore } from "../store/appStore";
import { PullbackStrip } from "./PullbackStrip";
import { AiVerifyStrip } from "./AiVerifyStrip";

export function AppShell({ children }: { children: ReactNode }) {
  // Mounted once here (not on any single page) so alerts keep firing across
  // the whole app no matter which page is currently open.
  useAlertEngine();
  useKeepScreenOn(useAppStore((s) => s.alertSettings.keepScreenOn ?? false));

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4 pb-24">
        {/* AI Verify Pro at a glance on the first five tabs (Ai20-20 has its own). */}
        <AiVerifyStrip />
        {/* Renders only on the six main tabs; null everywhere else. */}
        <PullbackStrip />
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
