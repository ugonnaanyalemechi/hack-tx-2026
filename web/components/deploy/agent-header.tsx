"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail } from "@/lib/contracts/registry";
import { cn } from "@/lib/utils";
import { formatScore } from "@/components/deploy/gate";

function leadSentence(agent: AgentDetail, report: EvalReportOut | null): string {
  const latest = agent.versions.at(-1);
  if (!latest) return "This agent has no versions yet.";
  const n = latest.version_number;
  if (agent.live_version_number === n) return `Version ${n} is live.`;
  if (latest.status === "blocked" && report?.version_number === n) {
    return `Version ${n} is blocked: it scored ${formatScore(report.score)}, under the ${formatScore(report.threshold)} it needs.`;
  }
  if (latest.status === "blocked") return `Version ${n} is blocked by the eval gate.`;
  return `Version ${n} is ready to test.`;
}

export function AgentHeader({
  agent,
  report,
  canDeploy,
  onDeploy,
}: {
  agent: AgentDetail;
  report: EvalReportOut | null;
  /** True for the owner while the latest version is not live. */
  canDeploy: boolean;
  /** Deploys the latest version through the eval gate; rejects with a readable error. */
  onDeploy: () => Promise<void>;
}) {
  const latest = agent.versions.at(-1);
  const latestIsLive = latest && agent.live_version_number === latest.version_number;
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeploy() {
    setDeploying(true);
    setError(null);
    try {
      await onDeploy();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The deploy failed. Try again.");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <header className="flex flex-col gap-4">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="size-3" aria-hidden />
        Your agents
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h1 text-text-primary">{agent.name}</h1>
            {agent.live_version_number !== null ? (
              <StatusBadge tone="success">Live · v{agent.live_version_number}</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Not live</StatusBadge>
            )}
            {latest && !latestIsLive ? (
              latest.status === "blocked" ? (
                <StatusBadge tone="error">v{latest.version_number} blocked</StatusBadge>
              ) : (
                <StatusBadge tone="info">v{latest.version_number} draft</StatusBadge>
              )
            ) : null}
          </div>
          <p className="max-w-140 text-sm text-text-secondary">
            {leadSentence(agent, report)} Edit the YAML in your repository and deploy again. This
            page shows results and cannot change the file.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/chat"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 rounded-pill border-white/16 bg-transparent px-4.5 text-sm text-text-primary hover:border-white/24 hover:bg-white/6"
            )}
          >
            Open chat
          </Link>
          {canDeploy && latest ? (
            <Button
              type="button"
              onClick={handleDeploy}
              disabled={deploying}
              className="h-10 gap-1.5 rounded-pill bg-neutral-50 px-4.5 text-sm font-medium text-text-inverse hover:bg-white disabled:bg-white/12 disabled:text-text-disabled disabled:opacity-100"
            >
              {deploying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Running test cases…
                </>
              ) : (
                `Deploy v${latest.version_number}`
              )}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex w-fit items-center gap-2 rounded-lg border border-error/28 bg-error/12 px-4 py-2.5 text-sm text-error"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </header>
  );
}
