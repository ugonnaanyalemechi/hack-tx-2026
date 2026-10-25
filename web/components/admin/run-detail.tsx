"use client";

import type { ApprovalDecision, RunStepEntry } from "@/lib/contracts/api";
import { runHasCost, stepHasCost } from "@/lib/contracts/api";
import { isForbidden } from "@/lib/api/client";
import {
  ENTRY_POINT,
  RUN_STATUS,
  formatCost,
  formatCount,
  formatDateTime,
  formatDuration,
  shortId,
  type Tone,
} from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, NoAccessState } from "@/components/shell/states";

/** One run, step by step: timing, tokens, cost and any error (story 49). */
export function RunDetail({
  runId,
  agentNames,
  userNames,
}: {
  runId: string;
  agentNames: Map<string, string>;
  userNames: Map<string, string>;
}) {
  const detail = useApiQuery(`run:${runId}`, (api) => api.getRun(runId));
  const label = shortId(runId);

  return (
    <Card role="region" aria-label={`Run ${label}`}>
      <CardContent className="flex flex-col gap-5">
        {detail.status === "loading" ? (
          <div aria-busy="true" aria-label="Loading run" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-56" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : detail.status === "error" ? (
          isForbidden(detail.error) ? (
            <NoAccessState title="You can't open this run.">
              Only admins and the agent&apos;s owner can read its run log.
            </NoAccessState>
          ) : (
            <ErrorState
              title={detail.error.status === 404 ? "Run not found." : "Couldn't load this run."}
              message={detail.error.message}
              onRetry={detail.error.status === 404 ? undefined : detail.retry}
            />
          )
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-h3 text-text-primary" title={detail.data.run.id}>
                  {label}
                </h2>
                <Badge variant={RUN_STATUS[detail.data.run.status].tone}>
                  {RUN_STATUS[detail.data.run.status].label}
                </Badge>
              </div>
              <p className="text-sm text-text-secondary">
                {agentNames.get(detail.data.run.agent_id) ?? shortId(detail.data.run.agent_id)}
                {" · "}
                {userNames.get(detail.data.run.user_id) ?? detail.data.run.user_id}
                {" · "}
                {ENTRY_POINT[detail.data.run.entry_point]}
              </p>
              <p className="font-mono text-xs text-text-muted">
                {formatDateTime(detail.data.run.created_at)}
                {" · "}
                {formatDuration(detail.data.run.duration_ms)}
                {runHasCost(detail.data.run)
                  ? ` · ${formatCost(detail.data.run.cost_total)}`
                  : null}
              </p>
            </div>

            {detail.data.steps.length === 0 ? (
              <EmptyState title="No steps recorded yet." className="p-6" />
            ) : (
              <ol className="flex flex-col">
                {detail.data.steps.map((step) => (
                  <StepRow key={step.id} step={step} />
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const APPROVAL_TONE: Record<string, Tone> = {
  approved: "success",
  rejected: "error",
  pending: "warning",
};

function approvalLine(approval: ApprovalDecision | null): string {
  if (!approval || approval.status === "pending" || !approval.decided_at) {
    return "Waiting for a decision";
  }
  const verb = approval.status === "approved" ? "Approved" : "Rejected";
  const who = approval.decided_by_name ?? approval.decided_by ?? "someone";
  return `${verb} by ${who} · ${formatDateTime(approval.decided_at)}`;
}

function stepTitle(step: RunStepEntry): string {
  switch (step.kind) {
    case "model":
      return "Model call";
    case "tool":
      return `Tool: ${step.name}`;
    case "approval":
      return `Approval: ${step.approval?.tool_name ?? step.name}`;
    case "guard":
      return `Guardrail: ${step.name}`;
    default:
      return step.name;
  }
}

function modelLine(step: RunStepEntry): string | null {
  const model = step.name.includes("/") ? step.name.split("/").pop() : step.name;
  if (!stepHasCost(step) || step.input_tokens === null) return model ?? null;
  const parts = [`${formatCount(step.input_tokens)} in`];
  if (step.cached_input_tokens) parts.push(`${formatCount(step.cached_input_tokens)} cached`);
  if (step.output_tokens !== null) parts.push(`${formatCount(step.output_tokens)} out`);
  return `${model} · ${parts.join(" · ")}`;
}

function StepRow({ step }: { step: RunStepEntry }) {
  const approval = step.kind === "approval" ? step.approval : null;
  const sub =
    step.kind === "model"
      ? modelLine(step)
      : step.kind === "approval"
        ? approvalLine(approval)
        : null;
  const cost = stepHasCost(step) && step.cost !== null ? formatCost(step.cost) : null;
  const timing = [step.latency_ms !== null ? formatDuration(step.latency_ms) : null, cost]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex gap-3 border-b border-border-subtle py-3 last:border-b-0">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-pill border border-border-default font-mono text-xs text-text-secondary">
        {step.sequence}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-sm font-medium text-text-primary">{stepTitle(step)}</p>
          {step.kind === "approval" ? (
            <Badge variant={APPROVAL_TONE[approval?.status ?? "pending"] ?? "neutral"}>
              {approval?.status === "approved"
                ? "Approved"
                : approval?.status === "rejected"
                  ? "Rejected"
                  : "Pending"}
            </Badge>
          ) : timing ? (
            <span className="shrink-0 font-mono text-xs text-text-secondary tabular-nums">
              {timing}
            </span>
          ) : null}
        </div>
        {sub ? <p className="text-xs text-text-muted">{sub}</p> : null}
        {step.error ? <p className="text-xs break-words text-error">{step.error}</p> : null}
      </div>
    </li>
  );
}
