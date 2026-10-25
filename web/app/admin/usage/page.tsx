"use client";

import { Wallet } from "lucide-react";
import { AdminFrame } from "@/components/admin/admin-frame";
import { UsageByAgent } from "@/components/admin/usage-by-agent";
import { UsageByDay } from "@/components/admin/usage-by-day";
import { StatBar } from "@/components/shell/stat-bar";
import { EmptyState, ErrorState } from "@/components/shell/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageReport } from "@/lib/contracts/api";
import { formatCost, formatCount } from "@/lib/format";
import { canOpenAdmin, useIdentity } from "@/lib/identity";
import { useApiQuery } from "@/lib/use-api-query";

export default function UsagePage() {
  const { role } = useIdentity();
  // End users may not read usage, so their screen never asks for it.
  const usage = useApiQuery(canOpenAdmin(role) ? "usage" : null, (api) => api.getUsage());

  return (
    <AdminFrame
      section="Usage"
      title="Where the money goes."
      subtitle="By agent and by day."
      noAccess="Usage is for admins and agent owners."
    >
      {usage.status === "loading" ? (
        <div aria-busy="true" aria-label="Loading usage" className="flex flex-col gap-6">
          <Skeleton className="h-28 rounded-xl" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      ) : usage.status === "error" ? (
        <ErrorState
          title="Couldn't load usage."
          message={usage.error.message}
          onRetry={usage.retry}
        />
      ) : usage.data.by_agent.length === 0 ? (
        <EmptyState icon={Wallet} title="No spend yet.">
          Spend shows up here once agents start running. Every model call is metered.
        </EmptyState>
      ) : (
        <UsageReportView report={usage.data} />
      )}
    </AdminFrame>
  );
}

function UsageReportView({ report }: { report: UsageReport }) {
  const totalMicros = report.by_agent.reduce(
    (sum, a) => sum + Math.round(Number(a.cost) * 1_000_000),
    0
  );
  const runs = report.by_agent.reduce((sum, a) => sum + a.runs, 0);
  const total = (totalMicros / 1_000_000).toFixed(6);
  const average = runs > 0 ? (totalMicros / runs / 1_000_000).toFixed(6) : "0";

  return (
    <div className="flex flex-col gap-6">
      <StatBar
        stats={[
          { label: "Total spend, all time", value: formatCost(total, 2), testId: "stat-spend" },
          { label: "Runs", value: formatCount(runs), testId: "stat-runs" },
          { label: "Agents with runs", value: formatCount(report.by_agent.length) },
          { label: "Average per run", value: formatCost(average) },
        ]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              By agent
            </CardTitle>
            <CardDescription>Each agent&apos;s runs and spend, and its share of the total.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageByAgent rows={report.by_agent} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              By day
            </CardTitle>
            <CardDescription>Spend per day, in UTC.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageByDay rows={report.by_day} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
