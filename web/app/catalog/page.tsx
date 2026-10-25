"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { PageBody, PageHero } from "@/components/shell/page-hero";
import { EmptyState, ErrorState } from "@/components/shell/states";
import { AgentCard } from "@/components/catalog/agent-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

export default function CatalogPage() {
  const { users } = useIdentity();
  const [search, setSearch] = useState("");
  // The catalog is small; one page at the API's maximum covers it.
  const catalog = useApiQuery("catalog", (api) => api.listCatalog({ limit: 100 }));

  const ownerNames = useMemo(() => {
    const list = users.status === "ready" ? users.users : [];
    return new Map(list.map((u) => [u.id, u.name]));
  }, [users]);

  const query = search.trim().toLowerCase();
  const agents =
    catalog.status === "ready"
      ? catalog.data.items.filter(
          (a) =>
            !query ||
            a.name.toLowerCase().includes(query) ||
            a.description.toLowerCase().includes(query)
        )
      : [];

  return (
    <AppShell>
      <PageHero
        overline="Agent catalog"
        title="Find an agent and ask it."
        subtitle="Every answer cited."
        lead="Every agent here is tested before it goes live and runs inside a budget. Anyone on the team can open one."
      >
        <div className="relative w-full max-w-md">
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
            An agent shows up here once a builder deploys it and it passes its evals.
          </EmptyState>
        ) : agents.length === 0 ? (
          <EmptyState title={`No agents match “${search.trim()}”.`}>
            Try a different name or word from the description.
          </EmptyState>
        ) : (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <li key={agent.id}>
                <AgentCard
                  agent={agent}
                  ownerName={ownerNames.get(agent.owner_id) ?? agent.owner_id}
                />
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </AppShell>
  );
}
