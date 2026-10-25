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
import type { BuildConnector } from "@/lib/build-form";
import type { AssistantSuggestion, ValidateResult } from "@/lib/api/mock-build";
import type { DeployResponse, EvalReportOut } from "@/lib/contracts/evals";
import type { AgentDetail } from "@/lib/contracts/registry";
import type {
  EvalCaseOut,
  SaveAsTestCaseRequest,
  TicketDetail,
  TicketListItem,
  TicketStatus,
} from "@/lib/contracts/tickets";

export interface TicketsParams extends PageParams {
  agentId?: string | null;
  status?: TicketStatus | null;
}

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
  /** `GET /v1/tickets`: admin sees all, a builder their own agents'. */
  listTickets(params?: TicketsParams): Promise<Page<TicketListItem>>;
  /** `GET /v1/tickets/{id}`. */
  getTicket(ticketId: string): Promise<TicketDetail>;
  /** `POST /v1/tickets/{id}/resolve`: idempotent. */
  resolveTicket(ticketId: string): Promise<TicketDetail>;
  /** `POST /v1/tickets/{id}/save-as-test-case`: 201 with the new eval case. */
  saveTicketAsTestCase(ticketId: string, body: SaveAsTestCaseRequest): Promise<EvalCaseOut>;
  /** `GET /v1/agents/{id}`: the agent with every version (deploy and eval views). */
  getAgentDetail(agentId: string): Promise<AgentDetail>;
  /**
   * Eval reports for the agent, newest first, so `[0]` is the latest test run
   * and an agent never tested returns `[]`. The live API only exposes the
   * latest report (`GET /v1/agents/{id}/eval-report`), so live returns at
   * most one; the mock returns one per tested version.
   */
  listEvalReports(agentId: string): Promise<EvalReportOut[]>;
  /**
   * `POST /v1/agents/{id}/versions/{n}/deploy`: runs the version through the
   * eval gate. With `overrideReason`, an admin deploys a blocked version anyway.
   */
  deployVersion(
    agentId: string,
    versionNumber: number,
    overrideReason?: string | null
  ): Promise<DeployResponse>;
  /** `GET /v1/agents/{id}/budget`: admin or the agent's owner only. */
  getBudget(agentId: string): Promise<BudgetOut>;
  /** `POST /v1/agents/{id}/budget/approve`: admin only. No amount grants one more base cap. */
  approveSpend(agentId: string, amount?: string | null): Promise<BudgetOut>;
  /** `GET /v1/admin/budgets`: every agent's budget, admin only. */
  listBudgets(): Promise<BudgetList>;
  /** `GET /v1/admin/queue`: what needs an admin (paused budgets, blocked deploys, tickets). */
  getAdminQueue(): Promise<AdminQueue>;
  /** `POST /v1/agents/validate`: checks an agent file, returns errors naming each bad field. */
  validateAgentSpec(specYaml: string): Promise<ValidateResult>;
  /** `POST /v1/agents`: 201 with the new agent and its first (draft) version. */
  createAgent(specYaml: string): Promise<AgentDetail>;
  /** `POST /v1/agents/{id}/versions`: 201 with the agent including the new version. */
  addAgentVersion(agentId: string, specYaml: string): Promise<AgentDetail>;
  /**
   * RUNTIME-PLACEHOLDER(#57): no backend route yet. Connectors the builder may
   * pick, with approval status. Replaced by the connector grants list
   * (`GET /v1/connectors`, platform).
   */
  listBuildConnectors(): Promise<BuildConnector[]>;
  /**
   * RUNTIME-PLACEHOLDER(#57): no backend route yet. Ask an admin to approve a
   * connector. Replaced by `POST /v1/connectors/{id}/request-approval`.
   */
  requestConnectorApproval(connectorId: string): Promise<BuildConnector>;
  /**
   * RUNTIME-PLACEHOLDER(#15): the setup assistant. Mock matches keywords in
   * canned results; replaced by `POST /v1/agents/suggest`, a metered model call.
   */
  suggestAgentForm(description: string): Promise<AssistantSuggestion>;
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
