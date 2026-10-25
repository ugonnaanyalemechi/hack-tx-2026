"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { EvalReportOut } from "@/lib/contracts/evals";
import type { AgentVersionOut } from "@/lib/contracts/registry";
import { formatScore, gateOutcome } from "@/components/deploy/gate";

function explanation(report: EvalReportOut): string {
  const v = `v${report.version_number}`;
  switch (gateOutcome(report)) {
    case "allowed":
      return `Above the threshold, so ${v} could go live. If a run scores below it, the deploy is blocked until an admin overrides and gives a reason.`;
    case "blocked":
      return `Below the threshold, so ${v} is blocked. An admin can deploy it anyway with a written reason.`;
    case "overridden":
      return `Below the threshold, but an admin deployed ${v} anyway.`;
  }
}

function pendingExplanation(versionNumber: number | undefined, threshold: number | null): string {
  const rule =
    "If a run scores below the threshold, the deploy is blocked until an admin overrides and gives a reason.";
  if (versionNumber === undefined || threshold === null) return rule;
  return `v${versionNumber} needs ${formatScore(threshold)} to go live. ${rule}`;
}

export function DeployGateCard({
  report,
  pendingVersion,
  pendingThreshold,
  canOverride,
  onOverride,
}: {
  /** The latest eval report, or null before the agent's first test run. */
  report: EvalReportOut | null;
  /** With no report yet: the version a deploy would test, and its threshold. */
  pendingVersion?: AgentVersionOut;
  pendingThreshold: number | null;
  /** True for an admin looking at a report whose version is still blocked. */
  canOverride: boolean;
  /** Deploys the blocked version with the reason; rejects with a readable error. */
  onOverride: (reason: string) => Promise<void>;
}) {
  const titleId = "deploy-gate-title";
  const threshold = report?.threshold ?? pendingThreshold;
  const scoreText = `${report ? formatScore(report.score) : "—"} / ${
    threshold !== null ? formatScore(threshold) : "—"
  }`;

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Deploy gate</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={report ? Math.round(report.score * 100) : 0} className="gap-2">
          <ProgressLabel className="text-sm font-normal text-text-secondary">Score</ProgressLabel>
          <ProgressValue className="text-sm font-medium text-text-primary tabular-nums">
            {() => scoreText}
          </ProgressValue>
        </Progress>
        <p className="text-sm text-text-secondary">
          {report
            ? explanation(report)
            : pendingExplanation(pendingVersion?.version_number, pendingThreshold)}
        </p>
        {report?.override_reason ? (
          <blockquote className="rounded-md border border-border-subtle bg-white/3 p-3 text-sm text-text-primary">
            <span className="mb-1 block font-mono text-overline font-medium tracking-overline text-text-brand uppercase">
              Override reason
            </span>
            {report.override_reason}
          </blockquote>
        ) : null}
        {report && canOverride ? (
          <OverrideForm versionNumber={report.version_number} onOverride={onOverride} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function OverrideForm({
  versionNumber,
  onOverride,
}: {
  versionNumber: number;
  onOverride: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onOverride(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The override failed. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 border-t border-border-subtle pt-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="override-reason" className="text-xs text-text-secondary">
          Reason for override
        </Label>
        <Textarea
          id="override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          aria-describedby="override-reason-help"
          placeholder={`Why should v${versionNumber} ship below the threshold?`}
          className="min-h-20 rounded-md border-border-default bg-white/4 px-4 py-3 text-sm"
        />
        <p id="override-reason-help" className="text-xs text-text-muted">
          Required. It is saved on the eval report.
        </p>
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={!trimmed || submitting}
        className="h-10 w-full justify-center gap-1.5 rounded-pill bg-neutral-50 text-sm font-medium text-text-inverse hover:bg-white disabled:bg-white/12 disabled:text-text-disabled disabled:opacity-100"
      >
        {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Deploy v{versionNumber} anyway
      </Button>
    </form>
  );
}
