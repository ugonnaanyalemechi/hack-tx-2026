/**
 * Fixture data for the mock API client, shaped exactly on the backend
 * records. Users match `SEEDED_USERS` in `src/hack_tx_2026/seed.py`; costs
 * are computed from token counts with the gateway's pricing table so every
 * run's total is the sum of its steps, as the recorder keeps it.
 *
 * All data is synthetic.
 */

import type {
  AgentListItem,
  ApprovalDecision,
  EntryPoint,
  RunStatus,
  StepKind,
  UserPublic,
} from "@/lib/contracts/api";

export const MOCK_USERS: UserPublic[] = [
  { id: "usr_admin", name: "Ada Admin", role: "admin" },
  { id: "usr_builder", name: "Ben Builder", role: "builder" },
  { id: "usr_builder_2", name: "Cleo Builder", role: "builder" },
  { id: "usr_end_user", name: "Eli End User", role: "end_user" },
];

const FILINGS = "agt_1c7e4f0a9b2d4e6f8a1b3c5d7e9f0a2b";
const POLICY = "agt_2d8f5a1b0c3e4f7a9b2c4d6e8f0a1b3c";
const MARKET = "agt_3e9a6b2c1d4f5a8b0c3d5e7f9a1b2c4d";
const PR = "agt_4f0b7c3d2e5a6b9c1d4e6f8a0b2c3d5e";
const CAMPAIGN = "agt_5a1c8d4e3f6b7c0d2e5f7a9b1c3d4e6f";
const CREDIT = "agt_6b2d9e5f4a7c8d1e3f6a8b0c2d4e5f7a";

export const MOCK_AGENTS: AgentListItem[] = [
  {
    id: FILINGS,
    slug: "filings-analyst",
    name: "Filings Analyst",
    description: "Answers questions about company filings and cites the page.",
    owner_id: "usr_builder",
    live_version_number: 3,
    latest_version_number: 4,
  },
  {
    id: POLICY,
    slug: "policy-assistant",
    name: "Policy Assistant",
    description: "Finds the internal policy that applies and quotes the clause.",
    owner_id: "usr_builder_2",
    live_version_number: 4,
    latest_version_number: 5,
  },
  {
    id: MARKET,
    slug: "market-summary",
    name: "Market Summary",
    description: "Summarizes the morning's moves with a source for each number.",
    owner_id: "usr_builder_2",
    live_version_number: 1,
    latest_version_number: 1,
  },
  {
    id: PR,
    slug: "pr-reviewer",
    name: "PR Reviewer",
    description:
      "Reads a pull request and files an issue for each problem, after you approve.",
    owner_id: "usr_builder",
    live_version_number: 2,
    latest_version_number: 2,
  },
  {
    id: CAMPAIGN,
    slug: "campaign-copy-reviewer",
    name: "Campaign Copy Reviewer",
    description: "Checks marketing copy against compliance wording rules.",
    owner_id: "usr_builder_2",
    live_version_number: 1,
    latest_version_number: 1,
  },
  {
    // A draft that never went live: in the agent list, not in the catalog.
    id: CREDIT,
    slug: "credit-memo-drafter",
    name: "Credit Memo Drafter",
    description: "Drafts a credit memo from a borrower's statements.",
    owner_id: "usr_builder",
    live_version_number: null,
    latest_version_number: 1,
  },
];

// --- runs -------------------------------------------------------------------

/** Per-token prices from the gateway's pricing table (USD per token). */
const PRICE = {
  input: 0.75 / 1_000_000,
  cachedInput: 0.075 / 1_000_000,
  output: 3.75 / 1_000_000,
};

const MODEL = "gemini/gemini-3.8-flash";

export interface MockStep {
  id: string;
  sequence: number;
  kind: StepKind;
  name: string;
  latency_ms: number | null;
  error: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  /** Six-place decimal string, null for steps that cost nothing. */
  cost: string | null;
  approval: ApprovalDecision | null;
}

export interface MockRun {
  id: string;
  agent_id: string;
  user_id: string;
  entry_point: EntryPoint;
  status: RunStatus;
  duration_ms: number | null;
  created_at: string;
  cost_total: string;
  steps: MockStep[];
}

type StepSpec =
  | { kind: "model"; input: number; cached?: number; output: number; ms: number; error?: string }
  | { kind: "tool" | "guard"; name: string; ms: number; error?: string }
  | {
      kind: "approval";
      name: string;
      /** Approval steps wait on a person, so they carry no latency. */
      ms: null;
      decision: Omit<ApprovalDecision, "tool_name">;
    };

interface RunSpec {
  id: string;
  agent: string;
  user: string;
  entry: EntryPoint;
  status: RunStatus;
  durationMs: number | null;
  at: string;
  steps: StepSpec[];
}

function micros(value: number): number {
  return Math.round(value * 1_000_000);
}

function toDecimal(microDollars: number): string {
  return (microDollars / 1_000_000).toFixed(6);
}

function buildRun(spec: RunSpec): MockRun {
  let totalMicros = 0;
  const steps = spec.steps.map((s, i): MockStep => {
    const base = {
      id: `stp_${spec.id.slice(4)}${String(i + 1).padStart(2, "0")}`,
      sequence: i + 1,
      latency_ms: s.ms,
      error: "error" in s && s.error ? s.error : null,
      input_tokens: null,
      cached_input_tokens: null,
      output_tokens: null,
      cost: null,
      approval: null,
    };
    if (s.kind === "model") {
      const cached = s.cached ?? 0;
      const stepMicros = micros(
        s.input * PRICE.input + cached * PRICE.cachedInput + s.output * PRICE.output
      );
      totalMicros += stepMicros;
      return {
        ...base,
        kind: "model",
        name: MODEL,
        input_tokens: s.input,
        cached_input_tokens: cached,
        output_tokens: s.output,
        cost: toDecimal(stepMicros),
      };
    }
    if (s.kind === "approval") {
      return {
        ...base,
        kind: "approval",
        name: s.name,
        approval: { ...s.decision, tool_name: s.name },
      };
    }
    return { ...base, kind: s.kind, name: s.name };
  });
  return {
    id: spec.id,
    agent_id: spec.agent,
    user_id: spec.user,
    entry_point: spec.entry,
    status: spec.status,
    duration_ms: spec.durationMs,
    created_at: spec.at,
    cost_total: toDecimal(totalMicros),
    steps,
  };
}

/** The most recent runs, hand-written so every status and step kind shows. */
const RECENT: RunSpec[] = [
  {
    id: "run_8f2b6d0e4a1c4b7e9d2f5a8c1e3b6d90",
    agent: FILINGS,
    user: "usr_end_user",
    entry: "chat",
    status: "running",
    durationMs: null,
    at: "2026-10-25T14:20:05Z",
    steps: [{ kind: "model", input: 2_180, output: 88, ms: 940 }],
  },
  {
    id: "run_8f2a3c9e1b7d4f0a8c6e2b5d9f1a3c7e",
    agent: FILINGS,
    user: "usr_end_user",
    entry: "chat",
    status: "completed",
    durationMs: 4_100,
    at: "2026-10-25T14:12:00Z",
    steps: [
      { kind: "model", input: 2_140, output: 96, ms: 900 },
      { kind: "tool", name: "lookup_filing", ms: 1_100 },
      { kind: "model", input: 9_840, cached: 2_048, output: 312, ms: 1_600 },
      { kind: "guard", name: "strip_secrets", ms: 12 },
    ],
  },
  {
    id: "run_8f29b7d1e5a3c9f0b2d4e6a8c0f1b3d5",
    agent: PR,
    user: "usr_builder",
    entry: "chat",
    status: "awaiting_approval",
    durationMs: null,
    at: "2026-10-25T13:47:30Z",
    steps: [
      { kind: "model", input: 3_620, output: 140, ms: 1_050 },
      { kind: "tool", name: "fetch_pull_request", ms: 640 },
      { kind: "model", input: 14_200, cached: 3_400, output: 520, ms: 1_900 },
      {
        kind: "approval",
        name: "create_issue",
        ms: null,
        decision: {
          id: "apr_5c1e9a3d7b2f4e6a8c0d1f3b5e7a9c2d",
          status: "pending",
          decided_by: null,
          decided_by_name: null,
          decided_at: null,
        },
      },
    ],
  },
  {
    id: "run_8f28e4a0c6b2d8f1a3e5c7b9d0f2a4c6",
    agent: MARKET,
    user: "usr_end_user",
    entry: "chat",
    status: "paused",
    durationMs: null,
    at: "2026-10-25T12:05:10Z",
    steps: [
      { kind: "model", input: 2_960, output: 112, ms: 880 },
      { kind: "tool", name: "market_snapshot", ms: 720 },
    ],
  },
  {
    id: "run_8f27c1e7a3d9b5f2c4e6a8d0b1f3c5e7",
    agent: POLICY,
    user: "usr_admin",
    entry: "api",
    status: "completed",
    durationMs: 3_200,
    at: "2026-10-25T10:31:45Z",
    steps: [
      { kind: "model", input: 1_980, output: 72, ms: 760 },
      { kind: "tool", name: "search_policies", ms: 980 },
      { kind: "model", input: 7_410, cached: 1_536, output: 268, ms: 1_380 },
      { kind: "guard", name: "require_citation", ms: 9 },
    ],
  },
  {
    id: "run_8f26a9c5e1b7d3f0a2c4e6b8d1f3a5c7",
    agent: FILINGS,
    user: "usr_end_user",
    entry: "chat",
    status: "completed",
    durationMs: 3_700,
    at: "2026-10-25T09:18:20Z",
    steps: [
      { kind: "model", input: 2_212, output: 104, ms: 820 },
      { kind: "tool", name: "lookup_filing", ms: 1_020 },
      {
        kind: "approval",
        name: "save_note",
        ms: null,
        decision: {
          id: "apr_7e3a1c9f5b2d4e8a0c6f1b3d5a7e9c1f",
          status: "approved",
          decided_by: "usr_end_user",
          decided_by_name: "Eli End User",
          decided_at: "2026-10-25T09:18:41Z",
        },
      },
      { kind: "tool", name: "save_note", ms: 210 },
      { kind: "model", input: 10_120, cached: 2_048, output: 286, ms: 1_480 },
      { kind: "guard", name: "strip_secrets", ms: 11 },
    ],
  },
  {
    id: "run_8f25d3f9b5a1c7e0d2f4b6a8c9e1d3f5",
    agent: CAMPAIGN,
    user: "usr_builder_2",
    entry: "eval",
    status: "failed",
    durationMs: 900,
    at: "2026-10-25T08:02:00Z",
    steps: [
      {
        kind: "model",
        input: 1_640,
        output: 0,
        ms: 900,
        error: "upstream_timeout: the model provider timed out",
      },
    ],
  },
  {
    id: "run_8f24b8e2d6a0c4f7b1d3e5a9c2f4b6d8",
    agent: FILINGS,
    user: "usr_end_user",
    entry: "recheck",
    status: "completed",
    durationMs: 2_900,
    at: "2026-10-24T17:44:12Z",
    steps: [
      { kind: "model", input: 2_300, output: 92, ms: 840 },
      { kind: "tool", name: "lookup_filing", ms: 960 },
      { kind: "model", input: 9_960, cached: 4_096, output: 248, ms: 1_090 },
      { kind: "guard", name: "strip_secrets", ms: 10 },
    ],
  },
];

/** Deterministic pseudo-random numbers so fixtures never change between runs. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const TOOLS: Record<string, string> = {
  [FILINGS]: "lookup_filing",
  [POLICY]: "search_policies",
  [MARKET]: "market_snapshot",
  [PR]: "fetch_pull_request",
  [CAMPAIGN]: "check_wording",
};

/** Older completed and failed runs, spread over the previous days, so the
 * run log pages and the usage view has a week of history. */
function olderRuns(): RunSpec[] {
  const rand = seededRandom(19);
  const agents = [FILINGS, FILINGS, POLICY, MARKET, PR, CAMPAIGN];
  const users = ["usr_end_user", "usr_end_user", "usr_builder", "usr_builder_2", "usr_admin"];
  const out: RunSpec[] = [];
  let counter = 0x8f23;
  for (let daysAgo = 1; daysAgo <= 6; daysAgo += 1) {
    const perDay = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < perDay; i += 1) {
      const agent = agents[Math.floor(rand() * agents.length)];
      const user = users[Math.floor(rand() * users.length)];
      const failed = rand() < 0.12;
      const hour = 16 - i * 2 - Math.floor(rand() * 2);
      const day = 24 - daysAgo + 1;
      const at = `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(
        Math.floor(rand() * 60)
      ).padStart(2, "0")}:00Z`;
      const firstIn = 1_800 + Math.floor(rand() * 1_600);
      const secondIn = 6_000 + Math.floor(rand() * 9_000);
      const steps: StepSpec[] = failed
        ? [
            { kind: "model", input: firstIn, output: 80, ms: 700 },
            {
              kind: "tool",
              name: TOOLS[agent],
              ms: 3_000,
              error: "tool_timeout: the connector did not answer in time",
            },
          ]
        : [
            { kind: "model", input: firstIn, output: 60 + Math.floor(rand() * 80), ms: 800 },
            { kind: "tool", name: TOOLS[agent], ms: 600 + Math.floor(rand() * 900) },
            {
              kind: "model",
              input: secondIn,
              cached: 2_048,
              output: 180 + Math.floor(rand() * 260),
              ms: 1_100 + Math.floor(rand() * 900),
            },
            { kind: "guard", name: "strip_secrets", ms: 10 },
          ];
      const durationMs = steps.reduce((sum, s) => sum + (s.ms ?? 0), 0) + 120;
      const hex = counter.toString(16);
      counter -= 1;
      out.push({
        id: `run_${hex}${"0123456789abcdef0123456789ab".slice(0, 28)}`,
        agent,
        user,
        entry: rand() < 0.2 ? "api" : "chat",
        status: failed ? "failed" : "completed",
        durationMs,
        at,
        steps,
      });
    }
  }
  return out;
}

/** Plain code-point order, as Python sorts strings on the backend. */
export function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every run, newest first (the order `GET /v1/runs` returns). */
export const MOCK_RUNS: MockRun[] = [...RECENT, ...olderRuns()]
  .map(buildRun)
  .sort((a, b) =>
    a.created_at === b.created_at
      ? byCodepoint(b.id, a.id)
      : byCodepoint(b.created_at, a.created_at)
  );
