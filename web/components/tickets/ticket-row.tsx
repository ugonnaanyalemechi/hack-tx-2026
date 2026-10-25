"use client";

/**
 * One flag ticket: the question, who flagged it and when, its status, and
 * the actions. Resolve and save-as-test-case render only when `canAct`
 * (an admin, or the owner of the ticket's agent); everyone else just reads.
 */

import Link from "next/link";
import { useState } from "react";
import { TestCaseForm } from "@/components/tickets/test-case-form";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import type { SaveAsTestCaseRequest, TicketListItem } from "@/lib/contracts/tickets";
import { formatDateTime } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "form" | "saving" | "saved";

function statusBadge(ticket: TicketListItem) {
  if (ticket.status === "resolved") return { label: "Resolved", tone: "success" as const };
  if (ticket.recheck_run_id) return { label: "Re-check done", tone: "info" as const };
  return { label: "Open", tone: "warning" as const };
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}

export function TicketRow({
  ticket,
  flaggedBy,
  canAct,
  onResolved,
}: {
  ticket: TicketListItem;
  flaggedBy: string;
  canAct: boolean;
  onResolved: (ticket: TicketListItem) => void;
}) {
  const { api } = useIdentity();
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const badge = statusBadge(ticket);
  const resolved = ticket.status === "resolved";

  async function resolve() {
    if (!api) return;
    setResolving(true);
    setResolveError(null);
    try {
      onResolved(await api.resolveTicket(ticket.id));
    } catch (error) {
      setResolveError(errorMessage(error));
    } finally {
      setResolving(false);
    }
  }

  async function saveTestCase(body: SaveAsTestCaseRequest) {
    if (!api) return;
    setSave("saving");
    setSaveError(null);
    try {
      await api.saveTicketAsTestCase(ticket.id, body);
      setSave("saved");
    } catch (error) {
      setSaveError(errorMessage(error));
      setSave("form");
    }
  }

  return (
    <li
      aria-label={ticket.question}
      data-testid="ticket-row"
      className="flex flex-col gap-3 border-b border-border-subtle py-4 last:border-b-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-text-primary">{ticket.question}</p>
          <p className="text-xs text-text-muted">
            {ticket.agent_name} · from {flaggedBy} · {formatDateTime(ticket.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.tone}>{badge.label}</Badge>
          {canAct && !resolved && save !== "saved" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={save === "form" || save === "saving"}
              onClick={() => setSave(save === "idle" ? "form" : "idle")}
              className="px-3"
            >
              Save as test case
            </Button>
          ) : null}
          {canAct && save === "saved" ? <Badge variant="success">Saved as test case</Badge> : null}
          {canAct && !resolved ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resolving}
              onClick={resolve}
              className="px-3"
            >
              {resolving ? "Resolving…" : "Resolve"}
            </Button>
          ) : null}
          <Link
            href={`/admin/runs?run=${encodeURIComponent(ticket.recheck_run_id ?? ticket.run_id)}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "px-3")}
          >
            View run
          </Link>
        </div>
      </div>

      {resolveError ? (
        <p role="alert" className="text-sm text-error">
          Couldn&apos;t resolve this ticket. {resolveError}
        </p>
      ) : null}

      {canAct && (save === "form" || save === "saving") ? (
        <TestCaseForm
          question={ticket.question}
          saving={save === "saving"}
          error={saveError}
          onSubmit={saveTestCase}
          onCancel={() => setSave("idle")}
        />
      ) : null}
    </li>
  );
}
