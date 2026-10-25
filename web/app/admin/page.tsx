"use client";

import { CheckCircle2 } from "lucide-react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { AdminQueueView } from "@/components/admin/admin-queue";
import { EmptyState, ErrorState, NoAccessState } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

/** Admin landing: the things waiting on an admin (docs/design/admin_budgets_approvals_tickets.png). */
export default function AdminHome() {
  const { role } = useIdentity();
  // The queue is admin only, so no other role's screen asks for it.
  const queue = useApiQuery(role === "admin" ? "admin-queue" : null, (api) =>
    api.getAdminQueue()
  );

  // RUNTIME-PLACEHOLDER(#56): connector requests have no backend route; the
  // mock serves them and live rejects. A failure here only hides the section.
  const connectors = useApiQuery(role === "admin" ? "admin-connector-requests" : null, (api) =>
    api.listConnectorRequests()
  );
  const connectorRequests = connectors.status === "ready" ? connectors.data : [];

  return (
    <AdminFrame
      section="Overview"
      title="Things need you."
      subtitle="Everything else is running."
      noAccess="The admin queue is for admins."
    >
      {role !== "admin" ? (
        <NoAccessState title="The admin queue is for admins.">
          Switch to Admin in the top right to see what is waiting. Builders can open the run log,
          usage and tickets above.
        </NoAccessState>
      ) : queue.status === "loading" ? (
        <div aria-busy="true" aria-label="Loading the queue" className="flex flex-col gap-6">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : queue.status === "error" ? (
        <ErrorState
          title="Couldn't load the queue."
          message={queue.error.message}
          onRetry={queue.retry}
        />
      ) : queue.data.items.length === 0 && connectorRequests.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nothing is waiting on you.">
          Paused budgets, blocked deploys, open flag tickets and connector requests show up here.
        </EmptyState>
      ) : (
        <AdminQueueView queue={queue.data} connectorRequests={connectorRequests} />
      )}
    </AdminFrame>
  );
}
