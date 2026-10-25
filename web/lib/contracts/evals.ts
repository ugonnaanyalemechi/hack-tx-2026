/**
 * Eval report and deploy-gate bodies.
 *
 * Mirrors `src/hack_tx_2026/models/evals.py` field-for-field (only the
 * shapes this UI reads or sends). Datetimes arrive as ISO 8601 strings.
 */

import type { AgentDetail } from "./registry";

export interface EvalCaseResult {
  case_id: string;
  question: string;
  passed: boolean;
  answer: string | null;
  missing_strings: string[];
  /** null when the case does not require a citation. */
  citation_ok: boolean | null;
  /** null when the case has no rubric or it was not graded. */
  rubric_passed: boolean | null;
  error: string | null;
}

export interface EvalReportOut {
  id: string;
  agent_id: string;
  version_number: number;
  score: number;
  threshold: number;
  /** Stays false after an admin override; `override_reason` records it. */
  passed: boolean;
  override_reason: string | null;
  per_case_results: EvalCaseResult[];
  created_at: string;
}

export interface DeployRequest {
  override_reason?: string | null;
}

export interface DeployResponse extends AgentDetail {
  eval_report: EvalReportOut | null;
}
