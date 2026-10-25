"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListX } from "lucide-react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { RunDetail } from "@/components/admin/run-detail";
import { RunLogTable } from "@/components/admin/run-log-table";
import { FilterChip } from "@/components/shell/filter-chip";
import { EmptyState, ErrorState } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { canOpenAdmin, useIdentity } from "@/lib/identity";
import { useApiQuery, usePagedQuery } from "@/lib/use-api-query";

export default function RunLogPage() {
  return (
    <Suspense fallback={<div className="flex-1 bg-canvas" />}>
      <RunLogForUser />
    </Suspense>
  );
}

/** Filters start over when the role switcher changes who is looking. */
function RunLogForUser() {
  const { currentUser } = useIdentity();
  return <RunLog key={currentUser?.id ?? "nobody"} />;
}

function RunLog() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { users, currentUser, role } = useIdentity();
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);

  // End users may not read run logs, so their screen never asks for one.
  const allowed = canOpenAdmin(role);
  const agents = useApiQuery(allowed ? "agents" : null, (api) => api.listAgents({ limit: 100 }));
  const runs = usePagedQuery(allowed ? `runs:${agentFilter ?? "all"}` : null, (api, cursor) =>
    api.listRuns({ agentId: agentFilter, cursor, limit: 20 })
  );

  const agentNames = useMemo(
    () =>
      new Map(agents.status === "ready" ? agents.data.items.map((a) => [a.id, a.name]) : []),
    [agents]
  );
  const userNames = useMemo(
    () => new Map(users.status === "ready" ? users.users.map((u) => [u.id, u.name]) : []),
    [users]
  );
  // Admins filter across every agent, builders across the ones they own.
  const filterAgents =
    agents.status === "ready"
      ? agents.data.items.filter((a) => role === "admin" || a.owner_id === currentUser?.id)
      : [];

  const allRuns = runs.state.status === "ready" ? runs.state.data : [];
  const visibleRuns = errorsOnly ? allRuns.filter((r) => r.status === "failed") : allRuns;
  const selectedRunId = searchParams.get("run") ?? visibleRuns[0]?.id ?? null;

  function runHref(runId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("run", runId);
    return `${pathname}?${params.toString()}`;
  }

  function selectRun(runId: string) {
    router.replace(runHref(runId), { scroll: false });
  }

  const filters = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by agent">
        <FilterChip selected={agentFilter === null} onClick={() => setAgentFilter(null)}>
          All agents
        </FilterChip>
        {filterAgents.map((agent) => (
          <FilterChip
            key={agent.id}
            selected={agentFilter === agent.id}
            onClick={() => setAgentFilter(agent.id)}
          >
            {agent.name}
          </FilterChip>
        ))}
      </div>
      <FilterChip selected={errorsOnly} onClick={() => setErrorsOnly((v) => !v)}>
        Errors only
      </FilterChip>
    </div>
  );

  return (
    <AdminFrame
      section="Run log"
      title="Every call, in order."
      subtitle="With what it cost."
      noAccess="The run log is for admins and agent owners."
      filters={filters}
    >
      <div className="grid items-start gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-8" size="sm">
          <CardContent className="flex flex-col gap-4">
            {runs.state.status === "loading" ? (
              <div aria-busy="true" aria-label="Loading runs" className="flex flex-col gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : runs.state.status === "error" ? (
              <ErrorState
                title="Couldn't load the run log."
                message={runs.state.error.message}
                onRetry={runs.retry}
              />
            ) : allRuns.length === 0 ? (
              <EmptyState icon={ListX} title="No runs yet.">
                Runs show up here as soon as someone chats with an agent or calls its API.
              </EmptyState>
            ) : (
              <>
                {visibleRuns.length === 0 ? (
                  <EmptyState title="No failed runs in this list." />
                ) : (
                  <RunLogTable
                    runs={visibleRuns}
                    agentNames={agentNames}
                    userNames={userNames}
                    selectedRunId={selectedRunId}
                    runHref={runHref}
                    onSelect={selectRun}
                  />
                )}
                {runs.loadMoreError ? (
                  <ErrorState
                    title="Couldn't load more runs."
                    message={runs.loadMoreError.message}
                    onRetry={runs.loadMore}
                  />
                ) : null}
                {runs.hasMore && !runs.loadMoreError ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={runs.loadMore}
                    disabled={runs.loadingMore}
                    className="self-center rounded-pill px-4"
                  >
                    {runs.loadingMore ? "Loading…" : "Load more"}
                  </Button>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-4">
          {selectedRunId ? (
            <RunDetail
              key={selectedRunId}
              runId={selectedRunId}
              agentNames={agentNames}
              userNames={userNames}
            />
          ) : runs.state.status === "ready" ? (
            <EmptyState title="Pick a run to see its steps." />
          ) : null}
        </div>
      </div>
    </AdminFrame>
  );
}
