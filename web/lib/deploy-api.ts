/**
 * Calls the deploy and eval views make to the platform API
 * (`src/hack_tx_2026/routers/platform.py` and `routers/evals.py`).
 *
 * Paths are relative: `next.config.ts` proxies `/v1/*` to the backend, and
 * Playwright fakes them at the network boundary. When #19's typed API client
 * lands, these three functions move onto it.
 */

import type { ErrorResponse } from "./contracts/api";
import type { DeployRequest, DeployResponse, EvalReportOut } from "./contracts/evals";
import type { AgentDetail } from "./contracts/registry";
import { IDENTITY_HEADER, type CurrentUser } from "./current-user-stand-in";

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

async function request<T>(path: string, user: CurrentUser, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        [IDENTITY_HEADER]: user.id,
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

function agentPath(agentId: string): string {
  return `/v1/agents/${encodeURIComponent(agentId)}`;
}

export function getAgent(agentId: string, user: CurrentUser): Promise<AgentDetail> {
  return request<AgentDetail>(agentPath(agentId), user);
}

/** The agent's most recent eval report, or null when it has never been tested. */
export async function getLatestEvalReport(
  agentId: string,
  user: CurrentUser
): Promise<EvalReportOut | null> {
  try {
    return await request<EvalReportOut>(`${agentPath(agentId)}/eval-report`, user);
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
  user: CurrentUser,
  overrideReason?: string
): Promise<DeployResponse> {
  const body: DeployRequest = overrideReason ? { override_reason: overrideReason } : {};
  return request<DeployResponse>(`${agentPath(agentId)}/versions/${versionNumber}/deploy`, user, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
