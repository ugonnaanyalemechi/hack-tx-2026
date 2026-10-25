"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { PageBody, PageHero } from "@/components/shell/page-hero";
import { EmptyState, ErrorState } from "@/components/shell/states";
import { AgentCard } from "@/components/catalog/agent-card";
import { FilterChip } from "@/components/shell/filter-chip";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApiMode } from "@/lib/api/config";
import { mockBudgetState } from "@/lib/api/mock-budgets";
import {
  CATALOG_CATEGORIES,
  getCatalogMeta,
  type CatalogCategory,
} from "@/lib/catalog-meta";
import { useIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { useApiQuery } from "@/lib/use-api-query";

export default function CatalogPage() {
  const { users, currentUser } = useIdentity();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  // The catalog is small; one page at the API's maximum covers it.
  const catalog = useApiQuery("catalog", (api) =>
    api.listCatalog({ limit: 100 }),
  );

  const ownerNames = useMemo(() => {
    const list = users.status === "ready" ? users.users : [];
    return new Map(list.map((u) => [u.id, u.name]));
  }, [users]);

  const query = search.trim().toLowerCase();
  const agents =
    catalog.status === "ready"
      ? catalog.data.items.filter(
          (a) =>
            (category === null ||
              getCatalogMeta(a.slug).category === category) &&
            (!query ||
              a.name.toLowerCase().includes(query) ||
              a.description.toLowerCase().includes(query)),
        )
      : [];

  return (
    <AppShell>
      <PageHero
        overline="Agent catalog"
        title="Find an agent and ask it."
        subtitle="Every answer cited."
        lead="Every agent here was forged, tested and signed off before it went live, and runs inside a budget. Anyone on the team can open one or copy it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-md flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-text-muted"
              aria-hidden
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents"
              aria-label="Search agents"
              className="h-11 rounded-pill border-border-default bg-white/4 pl-10 text-sm"
            />
          </div>
          <div
            role="group"
            aria-label="Filter by category"
            className="flex flex-wrap items-center gap-2"
          >
            <FilterChip
              selected={category === null}
              onClick={() => setCategory(null)}
            >
              All
            </FilterChip>
            {CATALOG_CATEGORIES.map((c) => (
              <FilterChip
                key={c}
                selected={category === c}
                onClick={() => setCategory(c)}
              >
                {c}
              </FilterChip>
            ))}
          </div>
          <Link
            href="/build/new"
            className={cn(
              buttonVariants({ variant: "default" }),
              "ml-auto h-11 px-5 text-sm",
            )}
          >
            Build an agent
          </Link>
        </div>
      </PageHero>

      <PageBody>
        {catalog.status === "loading" ? (
          <div
            aria-busy="true"
            aria-label="Loading agents"
            className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-60 rounded-xl" />
            ))}
          </div>
        ) : catalog.status === "error" ? (
          <ErrorState
            title="Couldn't load the catalog."
            message={catalog.error.message}
            onRetry={catalog.retry}
          />
        ) : catalog.data.items.length === 0 ? (
          <EmptyState title="No agents are live yet.">
            An agent shows up here once a builder deploys it and it passes its
            evals.
          </EmptyState>
        ) : agents.length === 0 ? (
          <EmptyState
            title={
              query
                ? `No agents match “${search.trim()}”.`
                : `No ${category?.toLowerCase()} agents are live yet.`
            }
          >
            Try a different name or word from the description.
          </EmptyState>
        ) : (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <li key={agent.id}>
                <AgentCard
                  agent={agent}
                  ownerName={ownerNames.get(agent.owner_id) ?? agent.owner_id}
                  isOwner={currentUser?.id === agent.owner_id}
                  nearBudget={nearBudget(agent.id)}
                />
              </li>
            ))}
            <li>
              <StartBuildCard />
            </li>
          </ul>
        )}
      </PageBody>
    </AppShell>
  );
}

/**
 * Whether spend is at 80% of the cap or more, as a flag only (no cost shown
 * to end users).
 *
 * RUNTIME-PLACEHOLDER(#22): end users cannot read a budget, so the mock reads
 * its shared budget store; live shows no badge until the runtime ticket
 * defines an end-user-safe budget signal.
 */
function nearBudget(agentId: string): boolean {
  if (resolveApiMode() !== "mock") return false;
  return mockBudgetState(agentId) !== "ok";
}

/** The dashed last card of the grid (docs/design/foundry/catalog.png). */
function StartBuildCard() {
  return (
    <div className="flex h-full min-h-60 flex-col justify-center gap-3 rounded-xl border border-dashed border-border-default p-6">
      <h2 className="font-serif text-h4 text-text-primary">
        Need one that is not here?
      </h2>
      <p className="text-sm text-text-secondary">
        Describe it in a sentence and the setup assistant will forge it from
        there.
      </p>
      <Link
        href="/build/new"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "mt-2 h-8 w-fit px-3.5",
        )}
      >
        Start a build
      </Link>
    </div>
  );
}
