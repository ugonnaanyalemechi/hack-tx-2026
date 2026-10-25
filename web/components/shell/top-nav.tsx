"use client";

/**
 * Shared top chrome: logo, the Catalog / Build / Admin tabs and the role
 * switcher. Tabs are real links; the active one follows the URL. The Admin
 * tab is hidden from end users, who may not read run logs or cost.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canOpenAdmin, useIdentity } from "@/lib/identity";
import type { Role } from "@/lib/contracts/api";
import { PillGroup, PillLink } from "@/components/shell/pill-group";
import { RoleSwitcher } from "@/components/shell/role-switcher";

interface NavTab {
  label: string;
  href: string;
  /** Path prefixes that make this tab the current one. */
  matches: string[];
  visibleTo?: (role: Role) => boolean;
}

const NAV_TABS: NavTab[] = [
  // Chat pages sit under the catalog, as in docs/design/chat_with_flag.png.
  { label: "Catalog", href: "/catalog", matches: ["/catalog", "/chat"] },
  { label: "Build", href: "/build", matches: ["/build"] },
  { label: "Admin", href: "/admin", matches: ["/admin"], visibleTo: canOpenAdmin },
];

function isActive(pathname: string, tab: NavTab): boolean {
  return tab.matches.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function TopNav() {
  const pathname = usePathname();
  const { role } = useIdentity();

  return (
    <header className="shrink-0 border-b border-border-subtle">
      <div className="mx-auto flex h-18 w-full max-w-wide items-center justify-between gap-4 px-6 lg:px-12">
        <Link
          href="/catalog"
          className="flex items-center gap-2.5 rounded-xs outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className="size-2 rounded-pill bg-spark" aria-hidden />
          <span className="font-serif text-base font-semibold tracking-wordmark text-text-primary uppercase">
            Foundry
          </span>
        </Link>

        <nav aria-label="Primary">
          <PillGroup>
            {NAV_TABS.filter((tab) => !tab.visibleTo || tab.visibleTo(role)).map((tab) => (
              <PillLink key={tab.href} href={tab.href} active={isActive(pathname, tab)}>
                {tab.label}
              </PillLink>
            ))}
          </PillGroup>
        </nav>

        <RoleSwitcher />
      </div>
    </header>
  );
}
