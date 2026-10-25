"use client";

/**
 * Pending connector requests (docs/design/admin_budgets_approvals_tickets.png,
 * "Connector requests"): connector, requesting agent and owner, scope, and
 * Approve (steel primary) / Deny (ghost) pills with an optional deny reason.
 * Decisions are optimistic; the parent rolls back and shows `errors[id]`.
 */

import { Plug } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shell/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConnectorDecision, ConnectorRequest, ConnectorScope } from "@/lib/contracts/connectors";
import { formatDateTime } from "@/lib/format";

export const SCOPE_LABEL: Record<ConnectorScope, string> = {
  read_only: "read only",
  can_change: "can change things",
};

function RequestRow({
  request,
  error,
  onDecide,
}: {
  request: ConnectorRequest;
  error: string | undefined;
  onDecide: (decision: ConnectorDecision, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const inputId = `deny-reason-${request.id}`;
  return (
    <li
      data-testid="connector-request"
      className="flex flex-col gap-3 border-b border-border-subtle py-4 first:pt-0 last:border-b-0 last:pb-0"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">{request.connector_name}</span>
        <span className="text-xs text-text-muted">
          {request.agent_name} · {SCOPE_LABEL[request.scope]}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {request.detail} · owner {request.owner_name} · {formatDateTime(request.requested_at)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="px-4"
          aria-label={`Approve ${request.connector_name} for ${request.agent_name}`}
          onClick={() => onDecide("approve", "")}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="border-border-default px-4"
          aria-label={`Deny ${request.connector_name} for ${request.agent_name}`}
          onClick={() => onDecide("deny", reason.trim())}
        >
          Deny
        </Button>
        <label htmlFor={inputId} className="sr-only">
          Reason for denying {request.connector_name} for {request.agent_name} (optional)
        </label>
        <Input
          id={inputId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for deny (optional)"
          className="h-7 max-w-64 flex-1 text-xs"
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function ConnectorRequestsCard({
  requests,
  errors,
  onDecide,
}: {
  requests: ConnectorRequest[];
  errors: Record<string, string>;
  onDecide: (request: ConnectorRequest, decision: ConnectorDecision, reason: string) => void;
}) {
  return (
    <Card role="region" aria-label="Connector requests">
      <CardHeader>
        <CardTitle>Connector requests</CardTitle>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <EmptyState icon={Plug} title="No requests waiting.">
            When an agent owner asks for a connector, the request shows up here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col">
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                error={errors[request.id]}
                onDecide={(decision, reason) => onDecide(request, decision, reason)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
