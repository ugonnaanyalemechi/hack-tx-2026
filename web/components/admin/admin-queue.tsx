import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatBar } from "@/components/shell/stat-bar";
import type {
  AdminQueue,
  BlockedDeployItem,
  BudgetPauseItem,
  OpenTicketItem,
} from "@/lib/contracts/budgets";
import type { ConnectorRequest } from "@/lib/contracts/connectors";
import { formatCost, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function QueueRow({
  title,
  detail,
  badge,
  href,
  action,
}: {
  title: string;
  detail: string;
  badge?: ReactNode;
  href: string;
  action: string;
}) {
  return (
    <li
      data-testid="queue-row"
      className="flex items-center justify-between gap-4 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-text-primary">{title}</span>
        <span className="text-xs text-text-muted tabular-nums">{detail}</span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {badge}
        <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "px-3")}>
          {action}
        </Link>
      </div>
    </li>
  );
}

function QueueSection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Badge variant={count > 0 ? "warning" : "neutral"}>{count}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-text-muted">{empty}</p>
        ) : (
          <ul className="flex flex-col">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

/** What is waiting on an admin, grouped by kind, each row linking to the page that clears it. */
export function AdminQueueView({
  queue,
  connectorRequests = [],
}: {
  queue: AdminQueue;
  /** Pending connector requests; fetched separately, so the shared queue contract is untouched. */
  connectorRequests?: ConnectorRequest[];
}) {
  const pauses = queue.items.filter((i): i is BudgetPauseItem => i.kind === "budget_pause");
  const blocked = queue.items.filter((i): i is BlockedDeployItem => i.kind === "blocked_deploy");
  const tickets = queue.items.filter((i): i is OpenTicketItem => i.kind === "open_ticket");

  return (
    <div className="flex flex-col gap-6">
      <StatBar
        stats={[
          { label: "Budget pauses", value: String(pauses.length), testId: "queue-pauses" },
          { label: "Blocked deploys", value: String(blocked.length), testId: "queue-blocked" },
          { label: "Open flag tickets", value: String(tickets.length), testId: "queue-tickets" },
          {
            label: "Connector requests",
            value: String(connectorRequests.length),
            testId: "queue-connectors",
          },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <QueueSection title="Budget pauses" count={pauses.length} empty="No agent is paused at its cap.">
          {pauses.map((item) => (
            <QueueRow
              key={item.agent_id}
              title={item.agent_name}
              detail={`${formatCost(item.spent, 2)} of ${formatCost(item.cap_total, 2)} · every chat is paused`}
              badge={<Badge variant="error">Paused</Badge>}
              href="/admin/budgets"
              action="Approve spend"
            />
          ))}
        </QueueSection>

        <QueueSection
          title="Blocked deploys"
          count={blocked.length}
          empty="No version is stuck behind the eval gate."
        >
          {blocked.map((item) => (
            <QueueRow
              key={`${item.agent_id}-${item.version_number}`}
              title={`${item.agent_name} v${item.version_number}`}
              detail={`Scored ${item.score.toFixed(2)}, needs ${item.threshold.toFixed(2)} · ${formatDateTime(item.since)}`}
              badge={<Badge variant="error">Score {item.score.toFixed(2)}</Badge>}
              href={`/agents/${encodeURIComponent(item.agent_id)}/evals`}
              action="Review"
            />
          ))}
        </QueueSection>

        <QueueSection
          title="Open flag tickets"
          count={tickets.length}
          empty="Nothing flagged is waiting."
        >
          {tickets.map((item) => (
            <QueueRow
              key={item.ticket_id}
              title={item.question}
              detail={`${item.agent_name} · ${formatDateTime(item.since)}`}
              badge={<Badge variant="warning">Open</Badge>}
              href="/admin/tickets"
              action="Open tickets"
            />
          ))}
        </QueueSection>

        <QueueSection
          title="Connector requests"
          count={connectorRequests.length}
          empty="No connector is waiting for approval."
        >
          {connectorRequests.map((item) => (
            <QueueRow
              key={item.id}
              title={item.connector_name}
              detail={`${item.agent_name} · ${item.scope === "read_only" ? "read only" : "can change things"} · ${formatDateTime(item.requested_at)}`}
              badge={<Badge variant="warning">Pending</Badge>}
              href="/admin/connectors"
              action="Review"
            />
          ))}
        </QueueSection>
      </div>
    </div>
  );
}
