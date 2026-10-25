import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EvalCaseResult, EvalReportOut } from "@/lib/contracts/evals";
import { gateOutcome, type GateOutcome } from "@/components/deploy/gate";

const OUTCOME_BADGE: Record<GateOutcome, { tone: "success" | "error" | "warning"; label: string }> =
  {
    allowed: { tone: "success", label: "Deploy allowed" },
    blocked: { tone: "error", label: "Deploy blocked" },
    overridden: { tone: "warning", label: "Deployed by override" },
  };

/** Rubric cases are model-graded once their exact checks pass. */
function checkKind(result: EvalCaseResult): string {
  return result.rubric_passed !== null ? "Graded" : "Exact";
}

function failureReasons(result: EvalCaseResult): string[] {
  if (result.error) return [result.error];
  const reasons = [];
  if (result.missing_strings.length > 0) {
    reasons.push(`Missing ${result.missing_strings.map((s) => `“${s}”`).join(", ")}`);
  }
  if (result.citation_ok === false) reasons.push("No citation");
  if (result.rubric_passed === false) reasons.push("Rubric not met");
  return reasons;
}

export function TestRunCard({ report }: { report: EvalReportOut }) {
  const titleId = "test-run-title";
  const badge = OUTCOME_BADGE[gateOutcome(report)];
  const results = report.per_case_results;

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Test run for v{report.version_number}</CardTitle>
        <CardAction>
          <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default p-4 text-sm text-text-muted">
            This agent has no test cases, so the run passed without checking anything.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test case</TableHead>
                <TableHead className="w-24">Check</TableHead>
                <TableHead className="w-24">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((result) => {
                const reasons = result.passed ? [] : failureReasons(result);
                return (
                  <TableRow key={result.case_id}>
                    <TableCell className="whitespace-normal">
                      <span className="block">{result.question}</span>
                      {reasons.length > 0 ? (
                        <span className="mt-1 block text-xs text-text-muted">
                          {reasons.join(" · ")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-text-secondary">{checkKind(result)}</TableCell>
                    <TableCell>
                      {result.passed ? (
                        <StatusBadge tone="success">Pass</StatusBadge>
                      ) : (
                        <StatusBadge tone="error">Fail</StatusBadge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableCaption className="text-left">
              {results.length} {results.length === 1 ? "case" : "cases"}. Graded cases are scored
              by the same model as the agent.
            </TableCaption>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
