/**
 * Calls the deploy and eval views make to the platform API
 * (`src/hack_tx_2026/routers/platform.py` and `routers/evals.py`).
 *
 * Requests go to `API_BASE_URL` (proxied to the backend by `next.config.ts`)
 * acting as the user chosen in the role switcher (`useIdentity()` in
 * `lib/identity.tsx`); Playwright fakes them at the network boundary.
 * #19's `ApiClient` is read-only, so these write-capable calls live here.
 */

import { API_BASE_URL, IDENTITY_HEADER_NAME } from "./api/config";
import type { ErrorResponse } from "./contracts/api";
import type { DeployRequest, DeployResponse, EvalReportOut } from "./contracts/evals";
import type { AgentDetail } from "./contracts/registry";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, userId: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        [IDENTITY_HEADER_NAME]: userId,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network_error", "Couldn't reach the server.");
  }
  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => null)) as ErrorResponse | null;
  throw new ApiError(
    response.status,
    body?.error?.code ?? "http_error",
    body?.error?.message ?? `Request failed (${response.status}).`
  );
}

// RUNTIME-PLACEHOLDER(#26): no mock-mode path. Eval reports and deploy-gate results come only from the real eval runner (#27), which runs versions through the runtime's eval entry point (#26); until both land, only Playwright's network fake (tests/support/deploy-api.ts) serves these three calls. Replace with real responses and, if the demo needs it, add them to the mock client (lib/api/mock.ts).
function agentPath(agentId: string): string {
  return `/v1/agents/${encodeURIComponent(agentId)}`;
}

export function getAgent(agentId: string, userId: string): Promise<AgentDetail> {
  return request<AgentDetail>(agentPath(agentId), userId);
}

/** The agent's most recent eval report, or null when it has never been tested. */
export async function getLatestEvalReport(
  agentId: string,
  userId: string
): Promise<EvalReportOut | null> {
  try {
    return await request<EvalReportOut>(`${agentPath(agentId)}/eval-report`, userId);
  } catch (error) {
    if (error instanceof ApiError && error.code === "eval_report_not_found") return null;
    throw error;
  }
}

/**
 * Deploy a version through the eval gate. With `overrideReason`, an admin
 * deploys a blocked version anyway and the reason is logged on its report.
 */
export function deployVersion(
  agentId: string,
  versionNumber: number,
  userId: string,
  overrideReason?: string
): Promise<DeployResponse> {
  const body: DeployRequest = overrideReason ? { override_reason: overrideReason } : {};
  return request<DeployResponse>(`${agentPath(agentId)}/versions/${versionNumber}/deploy`, userId, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
