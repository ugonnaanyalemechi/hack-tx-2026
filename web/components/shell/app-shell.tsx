import type { ReactNode } from "react";
import { TopNav } from "@/components/shell/top-nav";

/** Page frame for every screen: top nav above, the page below. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopNav />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
