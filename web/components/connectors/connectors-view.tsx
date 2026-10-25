"use client";

/**
 * The Connectors screen body: pending requests and active grants. Approve and
 * Deny are optimistic: the row leaves the list at once, and comes back with an
 * error under it if the call fails.
 */

import { useState } from "react";
import { ConnectorGrantsCard } from "@/components/connectors/connector-grants-card";
import { ConnectorRequestsCard } from "@/components/connectors/connector-requests-card";
import { ErrorState } from "@/components/shell/states";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ConnectorDecision,
  ConnectorGrantRow,
  ConnectorRequest,
} from "@/lib/contracts/connectors";
import { useApiQuery } from "@/lib/use-api-query";
import { useIdentity } from "@/lib/identity";

export function ConnectorsView() {
  const { api } = useIdentity();
  const requests = useApiQuery("connector-requests", (c) => c.listConnectorRequests());
  const grants = useApiQuery("connector-grants", (c) => c.listConnectorGrants());

  // Request ids decided here (hidden at once), grants added by approving, and
  // the error to show under a request whose decision failed.
  const [decided, setDecided] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<ConnectorGrantRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function decide(request: ConnectorRequest, decision: ConnectorDecision, reason: string) {
    if (!api) return;
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== request.id)));
    setDecided((prev) => new Set(prev).add(request.id));
    api.decideConnectorRequest(request.id, decision, reason || null).then(
      (result) => {
        if (result.grant) {
          const grant = result.grant;
          setAdded((prev) => [grant, ...prev]);
        }
      },
      (error: unknown) => {
        setDecided((prev) => {
          const next = new Set(prev);
          next.delete(request.id);
          return next;
        });
        const what = decision === "approve" ? "approve" : "deny";
        const detail = error instanceof Error ? ` ${error.message}` : "";
        setErrors((prev) => ({
          ...prev,
          [request.id]: `Couldn't ${what} ${request.connector_name} for ${request.agent_name}.${detail}`,
        }));
      }
    );
  }

  if (requests.status === "loading" || grants.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading connectors" className="flex flex-col gap-6">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }
  if (requests.status === "error" || grants.status === "error") {
    const failed = requests.status === "error" ? requests : grants;
    if (failed.status !== "error") return null;
    return (
      <ErrorState
        title="Couldn't load connectors."
        message={failed.error.message}
        onRetry={() => {
          requests.retry();
          grants.retry();
        }}
      />
    );
  }

  const pending = requests.data.filter((r) => !decided.has(r.id));
  // A grant created here replaces nothing the server list already holds.
  const known = new Set(grants.data.map((g) => g.id));
  const rows = [...added.filter((g) => !known.has(g.id)), ...grants.data];

  return (
    <div className="flex flex-col gap-6">
      <ConnectorRequestsCard requests={pending} errors={errors} onDecide={decide} />
      <ConnectorGrantsCard grants={rows} />
    </div>
  );
}
