/**
 * A fake of the platform HTTP API for the deploy and eval views.
 *
 * Tests run against the real page in a real browser; only the network
 * boundary is faked. Every body here is typed with the TypeScript mirrors
 * of the backend models (`lib/contracts/*`), and the routes and error codes
 * match `src/hack_tx_2026/routers/platform.py` and `routers/evals.py`.
 *
 * Content is the demo Filings Analyst agent and its synthetic eval cases
 * (`src/hack_tx_2026/demo/seed_data.py`).
 */

import type { Page, Request } from "@playwright/test";
import type { ErrorResponse } from "../../lib/contracts/api";
import type {
  DeployRequest,
  DeployResponse,
  EvalCaseResult,
  EvalReportOut,
} from "../../lib/contracts/evals";
import type { AgentDetail, AgentVersionOut } from "../../lib/contracts/registry";

export const AGENT_ID = "agt_5f0c2a9e1b7d4c3a8e6f1a2b3c4d5e6f";

function specFor(minScore: number): Record<string, unknown> {
  return {
    spec_version: 1,
    name: "Filings Analyst",
    slug: "filings-analyst",
    description:
      "Answers questions about the quarterly filings of fictional demo companies and cites the filing it used.",
    model: "gemini/gemini-3.8-flash",
    instructions: "You are a filings analyst.",
    connectors: [
      {
        name: "filings-demo",
        allow_list: ["lookup_filing", "save_note"],
        side_effect_tools: ["save_note"],
      },
    ],
    budget: { monthly_cap: 25.0, warning_fraction: 0.8 },
    evals: { min_score: minScore },
    guardrails: { require_citation: true, strip_secrets: true },
    trigger: null,
  };
}

export function version(
  version_number: number,
  status: AgentVersionOut["status"],
  minScore = 0.8
): AgentVersionOut {
  return {
    version_number,
    status,
    created_at: `2026-10-2${version_number}T15:00:00Z`,
    spec: specFor(minScore),
  };
}

export function agentDetail(
  versions: AgentVersionOut[],
  live_version_number: number | null,
  owner_id = "usr_builder"
): AgentDetail {
  return {
    id: AGENT_ID,
    slug: "filings-analyst",
    name: "Filings Analyst",
    description:
      "Answers questions about the quarterly filings of fictional demo companies and cites the filing it used.",
    owner_id,
    live_version_number,
    latest_version_number: versions.at(-1)?.version_number ?? null,
    versions,
  };
}

const PASSING_CASES: EvalCaseResult[] = [
  {
    case_id: "evc_larkspur_revenue",
    question: "What revenue did Larkspur Widget Co. report for 2026-Q2?",
    passed: true,
    answer: "Larkspur reported revenue of $48.2 million for 2026-Q2 [FCT-LARK-2026Q2].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: null,
    error: null,
  },
  {
    case_id: "evc_bramblewood_income",
    question: "What was Bramblewood Robotics' net income in 2026-Q1?",
    passed: true,
    answer: "Bramblewood reported a net loss of $2.4 million [FCT-BRAM-2026Q1].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: null,
    error: null,
  },
  {
    case_id: "evc_quillfeather_eps",
    question: "What diluted EPS did Quillfeather Freight report for 2026-Q2?",
    passed: true,
    answer: "Diluted EPS was $0.87 [FCT-QUIL-2026Q2].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: null,
    error: null,
  },
  {
    case_id: "evc_larkspur_change",
    question: "How did Larkspur Widget Co.'s revenue change from 2026-Q1 to 2026-Q2?",
    passed: true,
    answer:
      "Revenue rose from $41.5 million to $48.2 million [FCT-LARK-2026Q1, FCT-LARK-2026Q2].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: null,
    error: null,
  },
  {
    case_id: "evc_quillfeather_guidance",
    question:
      "What full-year revenue guidance did Quillfeather Freight give in its 2026-Q2 filing?",
    passed: true,
    answer: "Quillfeather guided to $310 million for the full year [FCT-QUIL-2026Q2].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: null,
    error: null,
  },
  {
    case_id: "evc_bramblewood_summary",
    question: "Summarize Bramblewood Robotics' 2026-Q2 filing.",
    passed: true,
    answer:
      "Bramblewood reported $15.9 million of revenue and another net loss [FCT-BRAM-2026Q2].",
    missing_strings: [],
    citation_ok: true,
    rubric_passed: true,
    error: null,
  },
];

/** v2 of the demo agent scored 4 of 6: one missing figure, one uncited. */
const BLOCKED_CASES: EvalCaseResult[] = [
  PASSING_CASES[0],
  {
    ...PASSING_CASES[1],
    passed: false,
    answer: "Bramblewood reported net income of $2.4 million [FCT-BRAM-2026Q1].",
    missing_strings: ["net loss"],
  },
  PASSING_CASES[2],
  PASSING_CASES[3],
  {
    ...PASSING_CASES[4],
    passed: false,
    answer: "Quillfeather guided to $310 million for the full year.",
    citation_ok: false,
  },
  PASSING_CASES[5],
];

export function blockedReport(version_number = 2): EvalReportOut {
  return {
    id: "evr_v2_blocked",
    agent_id: AGENT_ID,
    version_number,
    score: 4 / 6,
    threshold: 0.8,
    passed: false,
    override_reason: null,
    per_case_results: BLOCKED_CASES,
    created_at: "2026-10-25T15:04:00Z",
  };
}

/** 5 of 6 passing clears the 0.80 threshold; the uncited answer still fails. */
export function passingReport(version_number = 2): EvalReportOut {
  return {
    id: "evr_v2_passing",
    agent_id: AGENT_ID,
    version_number,
    score: 5 / 6,
    threshold: 0.8,
    passed: true,
    override_reason: null,
    per_case_results: PASSING_CASES.map((c, i) => (i === 4 ? BLOCKED_CASES[4] : c)),
    created_at: "2026-10-25T15:04:00Z",
  };
}

type Reply = { status: number; body: unknown; delayMs?: number };

export interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeApiOptions {
  /** GET /v1/agents/{id}. A Reply overrides the default 200; a function is called per request. */
  agent: AgentDetail | Reply | (() => AgentDetail | Reply);
  /** GET /v1/agents/{id}/eval-report. null means "no report yet" (404). */
  report: EvalReportOut | null | Reply;
  /** POST /v1/agents/{id}/versions/{n}/deploy. */
  deploy?: (call: { versionNumber: number; body: DeployRequest | null }) => Reply;
}

function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message, details: null } };
}

export function apiError(status: number, code: string, message: string): Reply {
  return { status, body: errorBody(code, message) };
}

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && "status" in value && "body" in value;
}

function parseBody(request: Request): unknown {
  const raw = request.postData();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Route every /v1 call the page makes to the fake and record it. */
export async function fakePlatformApi(page: Page, options: FakeApiOptions) {
  const calls: RecordedCall[] = [];

  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call: RecordedCall = {
      method: request.method(),
      path: url.pathname,
      headers: await request.allHeaders(),
      body: parseBody(request),
    };
    calls.push(call);

    const reply = resolve(call, options);
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    await route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  return calls;
}

function resolve(call: RecordedCall, options: FakeApiOptions): Reply {
  const base = `/v1/agents/${AGENT_ID}`;
  if (call.method === "GET" && call.path === base) {
    const agent = typeof options.agent === "function" ? options.agent() : options.agent;
    return isReply(agent) ? agent : { status: 200, body: agent };
  }
  if (call.method === "GET" && call.path === `${base}/eval-report`) {
    if (options.report === null) {
      return apiError(404, "eval_report_not_found", "No eval report for this agent yet");
    }
    return isReply(options.report) ? options.report : { status: 200, body: options.report };
  }
  const deploy = call.path.match(new RegExp(`^${base}/versions/(\\d+)/deploy$`));
  if (call.method === "POST" && deploy && options.deploy) {
    return options.deploy({
      versionNumber: Number(deploy[1]),
      body: call.body as DeployRequest | null,
    });
  }
  return apiError(404, "not_found", `Fake API has no route for ${call.method} ${call.path}`);
}

/** The DeployResponse the backend returns once `versionNumber` is live. */
export function deployedResponse(
  agent: AgentDetail,
  versionNumber: number,
  report: EvalReportOut
): DeployResponse {
  return {
    ...agent,
    live_version_number: versionNumber,
    versions: agent.versions.map((v) =>
      v.version_number === versionNumber ? { ...v, status: "deployed" } : v
    ),
    eval_report: report,
  };
}
