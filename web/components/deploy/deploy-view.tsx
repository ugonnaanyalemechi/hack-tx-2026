"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { deployVersion, getAgent, getLatestEvalReport } from "@/lib/deploy-api";
import type { DeployResponse, EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail } from "@/lib/contracts/registry";
import { useCurrentUserStandIn } from "@/lib/current-user-stand-in";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentHeader } from "@/components/deploy/agent-header";
import { EvalStats } from "@/components/deploy/eval-stats";
import { TestRunCard } from "@/components/deploy/test-run-card";
import { DeployGateCard } from "@/components/deploy/deploy-gate-card";
import { VersionsCard } from "@/components/deploy/versions-card";
import { gateOutcome, minScoreOf } from "@/components/deploy/gate";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; agent: AgentDetail; report: EvalReportOut | null };

const PAGE_FRAME = "mx-auto flex w-full max-w-300 flex-col gap-8 px-12 pt-8 pb-16";

function withoutReport({ eval_report, ...agent }: DeployResponse): AgentDetail {
  void eval_report;
  return agent;
}

export function DeployView({ agentId }: { agentId: string }) {
  const user = useCurrentUserStandIn();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const attempt = useRef(0);

  // State is only set from the promise callbacks, never synchronously in the
  // effect; `load` already starts as "loading" for the first fetch.
  const fetchAll = useCallback(() => {
    const current = ++attempt.current;
    Promise.all([getAgent(agentId, user), getLatestEvalReport(agentId, user)])
      .then(([agent, report]) => {
        if (current === attempt.current) setLoad({ state: "ready", agent, report });
      })
      .catch((error: Error) => {
        if (current === attempt.current) setLoad({ state: "error", message: error.message });
      });
  }, [agentId, user]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function retry() {
    setLoad({ state: "loading" });
    fetchAll();
  }

  if (load.state === "loading") return <DeployViewSkeleton />;
  if (load.state === "error") return <LoadError message={load.message} onRetry={retry} />;

  const { agent, report } = load;
  const latest = agent.versions.at(-1);

  function applyDeploy(response: DeployResponse) {
    setLoad({ state: "ready", agent: withoutReport(response), report: response.eval_report ?? report });
  }

  const reportVersion = report
    ? agent.versions.find((v) => v.version_number === report.version_number)
    : undefined;
  const canOverride =
    user.role === "admin" &&
    report !== null &&
    gateOutcome(report) === "blocked" &&
    reportVersion?.status === "blocked";

  async function override(reason: string) {
    if (!report) return;
    applyDeploy(await deployVersion(agent.id, report.version_number, user, reason));
  }

  // Normal deploys are owner-only; the live version is never redeployed (#48).
  const canDeploy =
    user.id === agent.owner_id &&
    latest !== undefined &&
    agent.live_version_number !== latest.version_number;

  async function deployLatest() {
    if (!latest) return;
    applyDeploy(await deployVersion(agent.id, latest.version_number, user));
  }

  return (
    <main className={PAGE_FRAME}>
      <AgentHeader agent={agent} report={report} canDeploy={canDeploy} onDeploy={deployLatest} />
      <Tabs defaultValue="evals" className="gap-8">
        <TabsList variant="line" className="w-full justify-start border-b border-border-subtle">
          <TabsTrigger value="evals" className="flex-none px-0 pb-3">
            Evals
          </TabsTrigger>
          <TabsTrigger value="versions" className="ml-6 flex-none px-0 pb-3">
            Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="evals" className="flex flex-col gap-6">
          <EvalStats agent={agent} report={report} />
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-8">
              {report ? <TestRunCard report={report} /> : <NoTestRun />}
            </div>
            <div className="col-span-4">
              <DeployGateCard
                report={report}
                pendingVersion={latest}
                pendingThreshold={latest ? minScoreOf(latest) : null}
                canOverride={canOverride}
                onOverride={override}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="versions">
          <VersionsCard agent={agent} report={report} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export function DeployViewSkeleton() {
  return (
    <main className={PAGE_FRAME} aria-busy="true" aria-label="Loading agent">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-80 rounded-lg" />
        <Skeleton className="h-4 w-140 max-w-full" />
      </div>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-6">
        <Skeleton className="col-span-8 h-80 rounded-xl" />
        <Skeleton className="col-span-4 h-56 rounded-xl" />
      </div>
    </main>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className={PAGE_FRAME}>
      <div
        role="alert"
        className="flex max-w-140 flex-col gap-3 rounded-xl border border-error/28 bg-error/12 p-6 text-sm text-text-secondary"
      >
        <p className="flex items-center gap-2 font-medium text-error">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          Couldn&apos;t load this agent.
        </p>
        <p>{message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="w-fit rounded-pill"
        >
          Retry
        </Button>
      </div>
    </main>
  );
}

function NoTestRun() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <FlaskConical className="size-8 text-text-disabled" aria-hidden />
        <p className="text-sm font-medium text-text-primary">No test run yet.</p>
        <p className="max-w-100 text-sm text-text-muted">
          Deploying a version runs its test cases through the eval gate. The results show here.
        </p>
      </CardContent>
    </Card>
  );
}
