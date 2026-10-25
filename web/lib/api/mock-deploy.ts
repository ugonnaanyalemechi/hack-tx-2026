/**
 * Fixture versions, eval reports and the deploy gate for the mock API client.
 *
 * RUNTIME-PLACEHOLDER(#26): the real eval runner (#27) runs a version's test
 * cases through the runtime's eval entry point (#26). Until that lands, this
 * module fakes the whole loop: versions and per-version eval reports are
 * seeded, and "deploying" scores the version from a fixed table
 * (`FAKE_EVAL_OUTCOMES`), then applies the same gate rules the backend does:
 * at or above the threshold the version goes live, below it the version is
 * blocked, and only an admin may override a blocked version, with a reason.
 *
 * State is mutable module state, so a deploy sticks for the page session
 * (as tickets do in `mock-tickets.ts`). All data is synthetic.
 */

import type { BlockedDeployItem } from "@/lib/contracts/budgets";
import type { DeployResponse, EvalCaseResult, EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail, AgentListItem, AgentVersionOut } from "@/lib/contracts/registry";
import { ApiError } from "@/lib/api/client";
import { MOCK_AGENTS } from "@/lib/api/mock-data";

/** Every mock agent's `evals.min_score`, as in docs/design/admin_budgets_approvals_tickets.png. */
const THRESHOLD = 0.85;

interface AgentState {
  versions: AgentVersionOut[];
  live: number | null;
  /** Newest first. */
  reports: EvalReportOut[];
}

/** Test cases for the demo Filings Analyst, shaped on owner_view_evals_and_deploy.png. */
const CASES: { id: string; question: string; graded: boolean }[] = [
  { id: "segment_revenue", question: "Segment revenue matches the 10-K", graded: false },
  { id: "cites_page", question: "Cites a page for every figure", graded: false },
  { id: "margin_change", question: "Explains margin change in plain words", graded: true },
  { id: "missing_figure", question: "Declines to guess a missing figure", graded: true },
  { id: "operating_margin", question: "Operating margin matches the fiscal 2024 filing", graded: false },
  { id: "free_cash_flow", question: "Free cash flow quotes the right year", graded: false },
  { id: "auditor", question: "Names the auditor from the filing", graded: false },
  { id: "risk_factors", question: "Lists the risk factors added since last year", graded: true },
  { id: "segments_compare", question: "Compares two segments without mixing years", graded: true },
  { id: "share_count", question: "Share count matches the cover page", graded: false },
  { id: "restatement", question: "Points out a restatement note when present", graded: true },
  { id: "debt_ladder", question: "Debt maturity ladder totals correctly", graded: false },
];

function caseResults(passing: number): EvalCaseResult[] {
  return CASES.map((c, i) => {
    const passed = i < passing;
    return {
      case_id: `evc_${c.id}`,
      question: c.question,
      passed,
      answer: passed
        ? "The filing reports this figure on the cited page [10-K p.49]."
        : "The answer did not match the filing.",
      missing_strings: passed || c.graded ? [] : ["expected figure"],
      citation_ok: c.graded ? null : passed,
      rubric_passed: c.graded ? passed : null,
      error: null,
    };
  });
}

function report(
  agentId: string,
  versionNumber: number,
  score: number,
  passing: number,
  createdAt: string,
  override: string | null = null
): EvalReportOut {
  return {
    id: `evr_${agentId.slice(4, 12)}_v${versionNumber}`,
    agent_id: agentId,
    version_number: versionNumber,
    score,
    threshold: THRESHOLD,
    passed: score >= THRESHOLD,
    override_reason: override,
    per_case_results: caseResults(passing),
    created_at: createdAt,
  };
}

function specFor(agent: AgentListItem): Record<string, unknown> {
  return {
    spec_version: 1,
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    model: "gemini/gemini-3.8-flash",
    instructions: `You are ${agent.name}.`,
    connectors: [],
    budget: { monthly_cap: 50.0, warning_fraction: 0.8 },
    evals: { min_score: THRESHOLD },
    guardrails: { require_citation: true, strip_secrets: true },
    trigger: null,
  };
}

function versionOut(
  agent: AgentListItem,
  versionNumber: number,
  status: AgentVersionOut["status"]
): AgentVersionOut {
  return {
    version_number: versionNumber,
    status,
    created_at: `2026-10-${String(8 + versionNumber * 3).padStart(2, "0")}T15:00:00Z`,
    spec: specFor(agent),
  };
}

function seedAgent(agent: AgentListItem): AgentState {
  const latest = agent.latest_version_number ?? 0;
  const live = agent.live_version_number;
  const reports: EvalReportOut[] = [];
  const versions: AgentVersionOut[] = [];

  for (let n = 1; n <= latest; n++) {
    const status = n <= (live ?? 0) ? "deployed" : "draft";
    versions.push(versionOut(agent, n, status));
  }

  switch (agent.slug) {
    case "filings-analyst":
      // v4 is a draft that already passed a test run: "ready to test", Deploy v4.
      reports.push(
        report(agent.id, 4, 0.91, 11, "2026-10-25T14:20:00Z"),
        report(agent.id, 3, 0.89, 11, "2026-10-21T15:00:00Z"),
        report(agent.id, 2, 0.87, 10, "2026-10-17T15:00:00Z"),
        report(agent.id, 1, 0.86, 10, "2026-10-12T15:00:00Z")
      );
      break;
    case "policy-assistant":
      // v5 scored 0.78 against 0.85: the blocked deploy in the admin mockup.
      versions[4] = { ...versions[4], status: "blocked" };
      reports.push(
        report(agent.id, 5, 0.78, 9, "2026-10-25T13:00:00Z"),
        report(agent.id, 4, 0.88, 11, "2026-10-22T15:00:00Z"),
        report(agent.id, 3, 0.86, 10, "2026-10-18T15:00:00Z"),
        report(agent.id, 2, 0.87, 10, "2026-10-14T15:00:00Z"),
        report(agent.id, 1, 0.85, 10, "2026-10-09T15:00:00Z")
      );
      break;
    case "credit-memo-drafter":
      // Never tested: no report, the empty state of the eval view.
      break;
    default:
      for (let n = latest; n >= 1; n--) {
        reports.push(report(agent.id, n, 0.9, 11, `2026-10-${String(10 + n * 3).padStart(2, "0")}T15:00:00Z`));
      }
  }
  return { versions, live, reports };
}

/**
 * RUNTIME-PLACEHOLDER(#26): what a "test run" scores, keyed by `slug:vN`.
 * The real eval runner computes this from the agent's cases; anything not
 * listed passes at 0.90.
 */
const FAKE_EVAL_OUTCOMES: Record<string, { score: number; passing: number }> = {
  "filings-analyst:v4": { score: 0.91, passing: 11 },
  // Blocks on first deploy, so a builder can see the gate and an admin can override it.
  "credit-memo-drafter:v1": { score: 0.72, passing: 8 },
};

const state: Record<string, AgentState> = {};

function stateFor(agentId: string): AgentState | null {
  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  if (!agent) return null;
  return (state[agentId] ??= seedAgent(agent));
}

function notFound() {
  return new ApiError(404, { code: "agent_not_found", message: "Agent not found" });
}

function detail(agent: AgentListItem, s: AgentState): AgentDetail {
  return {
    ...agent,
    live_version_number: s.live,
    latest_version_number: s.versions.at(-1)?.version_number ?? null,
    versions: s.versions.map((v) => ({ ...v })),
  };
}

export function mockGetAgentDetail(agentId: string, opts: { empty?: boolean } = {}): AgentDetail {
  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  const s = stateFor(agentId);
  if (!agent || !s) throw notFound();
  if (opts.empty) return detail(agent, { versions: [], live: null, reports: [] });
  return detail(agent, s);
}

export function mockListEvalReports(agentId: string, opts: { empty?: boolean } = {}): EvalReportOut[] {
  const s = stateFor(agentId);
  if (!s) throw notFound();
  return opts.empty ? [] : s.reports.map((r) => ({ ...r }));
}

/** Where a deploy request comes from; the mock applies the backend's rules to it. */
export interface DeployCaller {
  id: string;
  role: string;
}

export function mockDeployVersion(
  agentId: string,
  versionNumber: number,
  caller: DeployCaller,
  overrideReason?: string | null
): DeployResponse {
  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  const s = stateFor(agentId);
  if (!agent || !s) throw notFound();
  const version = s.versions.find((v) => v.version_number === versionNumber);
  if (!version) {
    throw new ApiError(404, { code: "version_not_found", message: "Version not found" });
  }

  if (overrideReason !== undefined && overrideReason !== null) {
    if (caller.role !== "admin") {
      throw new ApiError(403, { code: "forbidden", message: "Only an admin can override the gate" });
    }
    if (version.status !== "blocked") {
      throw new ApiError(409, {
        code: "version_not_blocked",
        message: "Only a blocked version can be overridden",
      });
    }
    const existing = s.reports.find((r) => r.version_number === versionNumber);
    if (!existing || !overrideReason.trim()) {
      throw new ApiError(422, { code: "override_reason_required", message: "Give a reason to override" });
    }
    const overridden = { ...existing, override_reason: overrideReason.trim() };
    s.reports = s.reports.map((r) => (r === existing ? overridden : r));
    version.status = "deployed";
    s.live = versionNumber;
    return { ...detail(agent, s), eval_report: overridden };
  }

  if (caller.role !== "admin" && caller.id !== agent.owner_id) {
    throw new ApiError(403, { code: "forbidden", message: "Only the owner can deploy this agent" });
  }
  if (s.live === versionNumber) {
    throw new ApiError(409, { code: "already_live", message: `v${versionNumber} is already live` });
  }

  const outcome = FAKE_EVAL_OUTCOMES[`${agent.slug}:v${versionNumber}`] ?? { score: 0.9, passing: 11 };
  const fresh = report(agentId, versionNumber, outcome.score, outcome.passing, new Date().toISOString());
  s.reports = [fresh, ...s.reports.filter((r) => r.version_number !== versionNumber)];
  if (fresh.passed) {
    version.status = "deployed";
    s.live = versionNumber;
  } else {
    version.status = "blocked";
  }
  return { ...detail(agent, s), eval_report: fresh };
}

/** Blocked versions waiting on an admin (the admin queue's "blocked deploy" items). */
export function mockBlockedDeploys(): BlockedDeployItem[] {
  const items: BlockedDeployItem[] = [];
  for (const agent of MOCK_AGENTS) {
    const s = stateFor(agent.id);
    if (!s) continue;
    for (const version of s.versions) {
      if (version.status !== "blocked") continue;
      const r = s.reports.find((x) => x.version_number === version.version_number);
      if (!r) continue;
      items.push({
        kind: "blocked_deploy",
        agent_id: agent.id,
        agent_name: agent.name,
        version_number: version.version_number,
        score: r.score,
        threshold: r.threshold,
        since: r.created_at,
      });
    }
  }
  return items;
}
