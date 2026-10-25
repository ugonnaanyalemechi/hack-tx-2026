"use client";

/**
 * Frame for the admin screens: the hero with the admin section tabs, and
 * the access rule. Run logs, usage and cost are for admins and an agent's
 * owner (story 66), so an end user gets a no-access note instead.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { PageBody, PageHero } from "@/components/shell/page-hero";
import { PillGroup, PillLink } from "@/components/shell/pill-group";
import { NoAccessState } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenAdmin, useIdentity } from "@/lib/identity";

/** Sections under the Admin tab. Add new admin screens here. */
const ADMIN_SECTIONS = [
  { label: "Run log", href: "/admin/runs" },
  { label: "Usage", href: "/admin/usage" },
  { label: "Tickets", href: "/admin/tickets" },
  { label: "Budgets", href: "/admin/budgets" },
];

export function AdminSections() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections">
      <PillGroup>
        {ADMIN_SECTIONS.map((s) => (
          <PillLink key={s.href} href={s.href} active={pathname === s.href}>
            {s.label}
          </PillLink>
        ))}
      </PillGroup>
    </nav>
  );
}

export function AdminFrame({
  section,
  title,
  subtitle,
  noAccess,
  filters,
  children,
}: {
  /** Overline suffix, e.g. "Run log". */
  section: string;
  title: string;
  subtitle: string;
  /** Shown instead of the screen to roles that may not open it. */
  noAccess: string;
  filters?: ReactNode;
  children: ReactNode;
}) {
  const { currentUser, role } = useIdentity();
  const scope = role === "admin" ? "Admin" : "Your agents";

  if (currentUser && !canOpenAdmin(role)) {
    return (
      <AppShell>
        <PageHero overline={section} title={section} />
        <PageBody>
          <NoAccessState title={noAccess}>
            Switch to Admin or Builder in the top right to open it.
          </NoAccessState>
        </PageBody>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHero
        overline={`${scope} · ${section}`}
        title={title}
        subtitle={subtitle}
        aside={<AdminSections />}
      >
        {currentUser ? filters : null}
      </PageHero>
      <PageBody>
        {currentUser ? (
          children
        ) : (
          <Skeleton className="h-96 rounded-xl" aria-label="Loading" aria-busy="true" />
        )}
      </PageBody>
    </AppShell>
  );
}
