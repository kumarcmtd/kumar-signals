import type { ReactNode } from "react";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4 pb-24">{children}</main>
      <BottomNav />
    </div>
  );
}
