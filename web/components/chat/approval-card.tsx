"use client";

import { useId } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApprovalDecision, ApprovalRequest } from "@/lib/chat-types";

/** Plain-language framing for known side-effect tools. Unknown tools fall
 * back to their raw name so the card never hides what will run. */
const TOOL_PRESENTATION: Record<string, { title: string; approveLabel: string }> = {
  save_note: { title: "Save a note?", approveLabel: "Approve and save" },
};

function presentation(toolName: string) {
  return (
    TOOL_PRESENTATION[toolName] ?? {
      title: `Run ${toolName}?`,
      approveLabel: "Approve and run",
    }
  );
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function InFlight({ label }: { label: string }) {
  return (
    <>
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      {label}
    </>
  );
}

const STATUS_BADGE: Record<ApprovalRequest["status"], { label: string; className: string }> = {
  pending: { label: "Run paused", className: "border-warning/30 bg-warning/10 text-warning" },
  deciding: { label: "Run paused", className: "border-warning/30 bg-warning/10 text-warning" },
  approved: { label: "Approved", className: "border-success/30 bg-success/10 text-success" },
  rejected: { label: "Rejected", className: "border-border-default bg-white/8 text-neutral-200" },
};

export function ApprovalCard({
  approval,
  agentName,
  onDecide,
}: {
  approval: ApprovalRequest;
  agentName: string;
  onDecide: (decision: ApprovalDecision) => void;
}) {
  const titleId = useId();
  const { title, approveLabel } = presentation(approval.toolName);
  const decided = approval.status === "approved" || approval.status === "rejected";
  const deciding = approval.status === "deciding";
  const badge = STATUS_BADGE[approval.status];

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={deciding || undefined}
      className="mt-2 flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-border-default bg-surface-1 bg-plate p-6 shadow-e2"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "font-mono text-overline font-medium tracking-overline uppercase",
            decided ? "text-text-muted" : "text-text-brand"
          )}
        >
          {decided ? "Approval" : "Approval needed"}
        </span>
        <Badge
          variant="outline"
          className={cn("h-6 rounded-pill px-2.5", badge.className)}
        >
          {badge.label}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <h3
          id={titleId}
          className="text-2xl font-semibold tracking-tight text-text-primary"
        >
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-text-secondary">
          {agentName} wants to run a tool that changes something outside this
          chat. Nothing happens until you decide.
        </p>
      </div>

      <div
        data-testid="approval-tool-call"
        className="flex flex-col gap-1 rounded-md border border-border-subtle bg-canvas p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
      >
        <div className="text-text-brand">{approval.toolName}</div>
        {Object.entries(approval.toolInput).map(([key, value]) => (
          <div key={key} className="text-text-primary">
            {key}: {formatValue(value)}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-5">
        {decided ? (
          <p className="text-xs text-text-muted">
            {approval.status === "approved"
              ? `You approved this, so ${agentName} ran the tool.`
              : `You rejected this. ${agentName} was told and carried on without it.`}
          </p>
        ) : (
          <>
            {approval.error ? (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
              >
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {approval.error}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={deciding}
                onClick={() => onDecide("reject")}
                className="h-10 gap-2 border-border-default bg-transparent px-4.5 text-sm text-text-primary hover:border-border-strong hover:bg-white/6"
              >
                {deciding && approval.decision === "reject" ? (
                  <InFlight label="Rejecting…" />
                ) : (
                  "Reject"
                )}
              </Button>
              <Button
                type="button"
                disabled={deciding}
                onClick={() => onDecide("approve")}
                className="h-10 gap-2 bg-molten px-4.5 text-sm font-medium text-text-inverse hover:brightness-110"
              >
                {deciding && approval.decision === "approve" ? (
                  <InFlight label="Approving…" />
                ) : (
                  approveLabel
                )}
              </Button>
            </div>
            <p className="text-xs text-text-muted">
              If you reject, the agent is told this was declined and carries
              on without it.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
