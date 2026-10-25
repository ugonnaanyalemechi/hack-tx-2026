/**
 * The typed API client every screen talks to. Two implementations share
 * this interface: `createLiveClient` (real HTTP, `lib/api/live.ts`) and
 * `createMockClient` (in-memory fixtures shaped on the contract,
 * `lib/api/mock.ts`). Screens get a client already bound to the identity
 * chosen in the role switcher via `useApi()` (`lib/identity.tsx`).
 *
 * Add a method per endpoint (SDK style), never a generic `fetch(path)`.
 */

import type {
  AdminQueue,
  BudgetList,
  BudgetOut,
} from "@/lib/contracts/budgets";
import type {
  AgentListItem,
  CatalogItem,
  ErrorBody,
  Page,
  PageParams,
  RunDetailWithApprovals,
  RunListEntry,
  UsageReport,
  UserPublic,
} from "@/lib/contracts/api";

export interface RunsParams extends PageParams {
  agentId?: string | null;
}

export interface UsageParams {
  agentId?: string | null;
}

export interface ApiClient {
  /** `GET /v1/users`: seeded users for the role switcher. No identity needed. */
  listUsers(): Promise<UserPublic[]>;
  /** `GET /v1/catalog`: agents with a live version. */
  listCatalog(params?: PageParams): Promise<Page<CatalogItem>>;
  /** `GET /v1/agents`: every agent, live or not (names for the run log). */
  listAgents(params?: PageParams): Promise<Page<AgentListItem>>;
  /** `GET /v1/runs`: admin sees all, a builder sees their own agents. */
  listRuns(params?: RunsParams): Promise<Page<RunListEntry>>;
  /** `GET /v1/runs/{run_id}`. */
  getRun(runId: string): Promise<RunDetailWithApprovals>;
  /** `GET /v1/usage`: spend by agent and by day. */
  getUsage(params?: UsageParams): Promise<UsageReport>;
  /** `GET /v1/agents/{id}/budget`: admin or the agent's owner only. */
  getBudget(agentId: string): Promise<BudgetOut>;
  /** `POST /v1/agents/{id}/budget/approve`: admin only. No amount grants one more base cap. */
  approveSpend(agentId: string, amount?: string | null): Promise<BudgetOut>;
  /** `GET /v1/admin/budgets`: every agent's budget, admin only. */
  listBudgets(): Promise<BudgetList>;
  /** `GET /v1/admin/queue`: what needs an admin (paused budgets, blocked deploys, tickets). */
  getAdminQueue(): Promise<AdminQueue>;
}

/** An `ErrorResponse` from the API (or a network failure, status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorBody["details"];

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? null;
  }
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
