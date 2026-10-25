"use client";

/**
 * The flag ticket list: loading, error, empty and ready states in one
 * card, with a status filter. Resolving a ticket updates the list in
 * place without a refetch.
 */

import { Flag } from "lucide-react";
import { useMemo, useState } from "react";
import { TicketRow } from "@/components/tickets/ticket-row";
import { EmptyState, ErrorState } from "@/components/shell/states";
import { FilterChip } from "@/components/shell/filter-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketListItem, TicketStatus } from "@/lib/contracts/tickets";
import { canOpenAdmin, useIdentity } from "@/lib/identity";
import { usePagedQuery } from "@/lib/use-api-query";

const FILTERS: { label: string; status: TicketStatus | null }[] = [
  { label: "All", status: null },
  { label: "Open", status: "open" },
  { label: "Resolved", status: "resolved" },
];

export function TicketList() {
  const { users, role } = useIdentity();
  const [status, setStatus] = useState<TicketStatus | null>(null);
  // Tickets resolved here, keyed by id, layered over the loaded pages.
  const [resolved, setResolved] = useState<Record<string, TicketListItem>>({});

  const tickets = usePagedQuery(`tickets:${status ?? "all"}`, (api, cursor) =>
    api.listTickets({ status, cursor, limit: 20 })
  );

  const names = useMemo(
    () => new Map(users.status === "ready" ? users.users.map((u) => [u.id, u.name]) : []),
    [users]
  );

  const rows =
    tickets.state.status === "ready"
      ? tickets.state.data
          .map((t) => resolved[t.id] ?? t)
          .filter((t) => status === null || t.status === status)
      : [];
  const canAct = canOpenAdmin(role);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <FilterChip key={f.label} selected={status === f.status} onClick={() => setStatus(f.status)}>
            {f.label}
          </FilterChip>
        ))}
      </div>

      <Card size="sm">
        <CardContent className="flex flex-col">
          {tickets.state.status === "loading" ? (
            <div aria-busy="true" aria-label="Loading tickets" className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : tickets.state.status === "error" ? (
            <ErrorState
              title="Couldn't load the tickets."
              message={tickets.state.error.message}
              onRetry={tickets.retry}
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={Flag} title="No flag tickets.">
              {status === "open"
                ? "Nothing is waiting on you."
                : "When someone flags a wrong answer, a ticket shows up here."}
            </EmptyState>
          ) : (
            <>
              <ul aria-label="Flag tickets" className="flex flex-col">
                {rows.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    flaggedBy={names.get(ticket.created_by) ?? ticket.created_by}
                    canAct={canAct}
                    onResolved={(updated) =>
                      setResolved((prev) => ({ ...prev, [updated.id]: updated }))
                    }
                  />
                ))}
              </ul>
              {tickets.loadMoreError ? (
                <ErrorState
                  title="Couldn't load more tickets."
                  message={tickets.loadMoreError.message}
                  onRetry={tickets.loadMore}
                />
              ) : null}
              {tickets.hasMore && !tickets.loadMoreError ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={tickets.loadMore}
                  disabled={tickets.loadingMore}
                  className="mt-3 self-center rounded-pill px-4"
                >
                  {tickets.loadingMore ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
