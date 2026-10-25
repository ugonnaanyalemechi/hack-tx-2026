/**
 * HTTP API contract for the platform reads the web app uses: seeded users,
 * the catalog, the agent list, the run log, run detail and usage.
 *
 * Mirrors, field for field, `src/hack_tx_2026/models/api.py`,
 * `models/admin_reads.py`, `models/registry.py` and `models/records.py`.
 * The backend is the source of truth; change these only when it changes.
 *
 * JSON encoding notes (pydantic v2):
 * - Money (`Decimal`) arrives as a string with six places, e.g. "0.031000".
 * - Datetimes are ISO 8601 UTC strings; dates are "YYYY-MM-DD".
 * - Cost fields are omitted entirely (the key is absent, not null) for
 *   callers who are neither an admin nor the agent's owner. That is why the
 *   run shapes come in a `*Public` form and a form that adds cost.
 */

/** A decimal amount of US dollars, serialized as a string. */
export type DecimalString = string;
/** ISO 8601 datetime in UTC. */
export type IsoDateTime = string;
/** ISO 8601 calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

// --- shared -----------------------------------------------------------------

export interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ErrorResponse {
  error: ErrorBody;
}

export interface PageParams {
  limit?: number;
  cursor?: string | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** Seeded user roles (see `seed.py`). */
export type Role = "admin" | "builder" | "end_user";

export interface UserPublic {
  id: string;
  name: string;
  /** One of `Role` for seeded users; typed loosely as the backend does. */
  role: Role | (string & {});
}

// --- records ----------------------------------------------------------------

export type EntryPoint = "chat" | "api" | "recheck" | "eval";
export type RunStatus =
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed";
export type StepKind = "model" | "tool" | "approval" | "guard";

// --- catalog and registry ---------------------------------------------------

export interface CatalogItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  owner_id: string;
  live_version_number: number;
}

export interface AgentListItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  owner_id: string;
  live_version_number: number | null;
  latest_version_number: number | null;
}

// --- run log ----------------------------------------------------------------

export interface RunListItemPublic {
  id: string;
  agent_id: string;
  user_id: string;
  entry_point: EntryPoint;
  status: RunStatus;
  duration_ms: number | null;
  created_at: IsoDateTime;
}

export interface RunListItem extends RunListItemPublic {
  cost_total: DecimalString;
}

/** What `GET /v1/runs` returns per item: cost present only when allowed. */
export type RunListEntry = RunListItem | RunListItemPublic;

export interface RunStepPublic {
  id: string;
  sequence: number;
  /** A `StepKind`; typed as the backend does (plain `str`). */
  kind: StepKind | (string & {});
  name: string;
  latency_ms: number | null;
  error: string | null;
}

export interface RunStep extends RunStepPublic {
  cost: DecimalString | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
}

export interface ApprovalDecision {
  id: string;
  tool_name: string;
  status: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: IsoDateTime | null;
}

export interface RunStepDetailPublic extends RunStepPublic {
  approval: ApprovalDecision | null;
}

export interface RunStepDetail extends RunStep {
  approval: ApprovalDecision | null;
}

export type RunStepEntry = RunStepDetail | RunStepDetailPublic;

/** `GET /v1/runs/{run_id}`. */
export interface RunDetailWithApprovals {
  run: RunListEntry;
  steps: RunStepEntry[];
}

// --- usage ------------------------------------------------------------------

export interface AgentUsage {
  agent_id: string;
  agent_name: string;
  runs: number;
  cost: DecimalString;
}

export interface DayUsage {
  day: IsoDate;
  runs: number;
  cost: DecimalString;
}

/** `GET /v1/usage`: admin and owner only, so it always carries cost. */
export interface UsageReport {
  by_agent: AgentUsage[];
  by_day: DayUsage[];
}

// --- cost-omission guards ---------------------------------------------------

export function runHasCost(run: RunListEntry): run is RunListItem {
  return "cost_total" in run;
}

export function stepHasCost(step: RunStepEntry): step is RunStepDetail {
  return "cost" in step;
}
