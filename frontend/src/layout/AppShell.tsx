import type { ReactNode } from "react";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";
import { useAlertEngine } from "../hooks/useAlertEngine";

export function AppShell({ children }: { children: ReactNode }) {
  // Mounted once here (not on any single page) so alerts keep firing across
  // the whole app no matter which page is currently open.
  useAlertEngine();

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4 pb-24">{children}</main>
      <BottomNav />
    </div>
  );
}
