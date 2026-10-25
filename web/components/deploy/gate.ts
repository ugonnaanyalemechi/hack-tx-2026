/** Reads over the registry and eval-report contracts used across the deploy views. */

import type { EvalReportOut } from "@/lib/contracts/evals";
import type { AgentVersionOut } from "@/lib/contracts/registry";

/** Scores and thresholds are fractions; the UI always shows two places. */
export function formatScore(value: number): string {
  return value.toFixed(2);
}

export type GateOutcome = "allowed" | "blocked" | "overridden";

/** A report that failed but carries a reason was deployed by an admin override. */
export function gateOutcome(report: EvalReportOut): GateOutcome {
  if (report.passed) return "allowed";
  return report.override_reason ? "overridden" : "blocked";
}

export function casesPassing(report: EvalReportOut): { passed: number; total: number } {
  const results = report.per_case_results;
  return { passed: results.filter((r) => r.passed).length, total: results.length };
}

/** The version's own threshold, `evals.min_score` in its stored spec. */
export function minScoreOf(version: AgentVersionOut): number | null {
  const evals = version.spec.evals;
  if (typeof evals !== "object" || evals === null) return null;
  const minScore = (evals as Record<string, unknown>).min_score;
  return typeof minScore === "number" ? minScore : null;
}
