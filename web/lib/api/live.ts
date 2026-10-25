/** Live API client: real HTTP against the FastAPI backend. */

import type { ErrorResponse, PageParams } from "@/lib/contracts/api";
import { ApiError, type ApiClient } from "@/lib/api/client";
import { RuntimeNotAvailableError } from "@/lib/api/runtime-seams";
import type { EvalReportOut } from "@/lib/contracts/evals";

export interface LiveClientOptions {
  baseUrl: string;
  identityHeaderName: string;
  /** The seeded user to act as, or null before one is chosen. */
  userId: string | null;
}

type Query = Record<string, string | number | null | undefined>;

function pageQuery(params: PageParams = {}): Query {
  return { limit: params.limit, cursor: params.cursor };
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ErrorResponse).error?.code === "string"
  );
}

export function createLiveClient(options: LiveClientOptions): ApiClient {
  const { baseUrl, identityHeaderName, userId } = options;

  async function request<T>(
    method: "GET" | "POST",
    path: string,
    query: Query = {},
    body?: unknown
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== null && value !== undefined && value !== "") {
        search.set(key, String(value));
      }
    }
    const qs = search.toString();
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (userId) headers[identityHeaderName] = userId;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        cache: "no-store",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, {
        code: "network_error",
        message: "Couldn't reach the server.",
      });
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isErrorResponse(payload)) throw new ApiError(response.status, payload.error);
      throw new ApiError(response.status, {
        code: "http_error",
        message: `Request failed with status ${response.status}.`,
      });
    }
    return payload as T;
  }

  const get = <T>(path: string, query: Query = {}) => request<T>("GET", path, query);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, {}, body ?? {});

  return {
    listUsers: () => get("/v1/users"),
    listCatalog: (params) => get("/v1/catalog", pageQuery(params)),
    listAgents: (params) => get("/v1/agents", pageQuery(params)),
    listRuns: (params = {}) =>
      get("/v1/runs", { ...pageQuery(params), agent_id: params.agentId }),
    getRun: (runId) => get(`/v1/runs/${encodeURIComponent(runId)}`),
    getUsage: (params = {}) => get("/v1/usage", { agent_id: params.agentId }),
    listTickets: (params = {}) =>
      get("/v1/tickets", {
        ...pageQuery(params),
        agent_id: params.agentId,
        status: params.status,
      }),
    getTicket: (ticketId) => get(`/v1/tickets/${encodeURIComponent(ticketId)}`),
    resolveTicket: (ticketId) => post(`/v1/tickets/${encodeURIComponent(ticketId)}/resolve`),
    saveTicketAsTestCase: (ticketId, body) =>
      post(`/v1/tickets/${encodeURIComponent(ticketId)}/save-as-test-case`, body),
    getAgentDetail: (agentId) => get(`/v1/agents/${encodeURIComponent(agentId)}`),
    // Live exposes only the latest report, so this is a list of at most one.
    listEvalReports: async (agentId) => {
      try {
        return [await get<EvalReportOut>(`/v1/agents/${encodeURIComponent(agentId)}/eval-report`)];
      } catch (error) {
        if (error instanceof ApiError && error.code === "eval_report_not_found") return [];
        throw error;
      }
    },
    deployVersion: (agentId, versionNumber, overrideReason) =>
      post(
        `/v1/agents/${encodeURIComponent(agentId)}/versions/${versionNumber}/deploy`,
        overrideReason ? { override_reason: overrideReason } : undefined
      ),
    getBudget: (agentId) => get(`/v1/agents/${encodeURIComponent(agentId)}/budget`),
    approveSpend: (agentId, amount) =>
      post(
        `/v1/agents/${encodeURIComponent(agentId)}/budget/approve`,
        amount ? { amount } : undefined
      ),
    listBudgets: () => get("/v1/admin/budgets"),
    getAdminQueue: () => get("/v1/admin/queue"),
    validateAgentSpec: (specYaml) => post("/v1/agents/validate", { spec_yaml: specYaml }),
    createAgent: (specYaml) => post("/v1/agents", { spec_yaml: specYaml }),
    addAgentVersion: (agentId, specYaml) =>
      post(`/v1/agents/${encodeURIComponent(agentId)}/versions`, { spec_yaml: specYaml }),
    // RUNTIME-PLACEHOLDER(#57): no connector grants route yet.
    listBuildConnectors: () =>
      Promise.reject(new RuntimeNotAvailableError("Connector approvals aren't available yet", 57)),
    // RUNTIME-PLACEHOLDER(#57): no connector approval request route yet.
    requestConnectorApproval: () =>
      Promise.reject(new RuntimeNotAvailableError("Requesting approval isn't available yet", 57)),
    // RUNTIME-PLACEHOLDER(#15): needs a metered model call behind a route.
    suggestAgentForm: () =>
      Promise.reject(new RuntimeNotAvailableError("The setup assistant isn't available yet", 15)),
  };
}
