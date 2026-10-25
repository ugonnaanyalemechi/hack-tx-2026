import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail, AgentVersionOut } from "@/lib/contracts/registry";
import { formatScore, gateOutcome, minScoreOf } from "@/components/deploy/gate";

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function statusBadge(version: AgentVersionOut, liveNumber: number | null) {
  if (version.version_number === liveNumber) return { tone: "success", label: "Live" } as const;
  const byStatus: Record<string, { tone: StatusTone; label: string }> = {
    deployed: { tone: "neutral", label: "Deployed" },
    blocked: { tone: "error", label: "Blocked" },
    draft: { tone: "info", label: "Draft" },
  };
  return byStatus[version.status] ?? { tone: "neutral", label: version.status };
}

/**
 * Only the latest eval report is readable, so other versions show the
 * threshold from their own spec without a score.
 */
function evalCell(version: AgentVersionOut, report: EvalReportOut | null) {
  if (report?.version_number === version.version_number) {
    return (
      <>
        <span className="text-text-primary tabular-nums">
          {formatScore(report.score)} / {formatScore(report.threshold)}
        </span>
        {gateOutcome(report) === "overridden" ? (
          <span className="ml-2 text-xs text-text-muted">overridden</span>
        ) : null}
      </>
    );
  }
  const minScore = minScoreOf(version);
  return (
    <span className="text-text-muted tabular-nums" title="Only the latest test run's score is shown">
      — / {minScore !== null ? formatScore(minScore) : "—"}
    </span>
  );
}

export function VersionsCard({
  agent,
  report,
}: {
  agent: AgentDetail;
  report: EvalReportOut | null;
}) {
  const titleId = "versions-title";
  const newestFirst = [...agent.versions].reverse();

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Versions</CardTitle>
      </CardHeader>
      <CardContent>
        {newestFirst.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default p-4 text-sm text-text-muted">
            No versions yet. Deploy the agent&apos;s YAML file to create version 1.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Version</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead>Eval score</TableHead>
                <TableHead className="w-36 text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newestFirst.map((version) => {
                const badge = statusBadge(version, agent.live_version_number);
                return (
                  <TableRow key={version.version_number}>
                    <TableCell className="font-mono">v{version.version_number}</TableCell>
                    <TableCell>
                      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                    </TableCell>
                    <TableCell>{evalCell(version, report)}</TableCell>
                    <TableCell className="text-right text-text-secondary">
                      {DATE.format(new Date(version.created_at))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableCaption className="text-left">
              A version below its threshold stays blocked until an admin overrides it with a
              reason.
            </TableCaption>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
