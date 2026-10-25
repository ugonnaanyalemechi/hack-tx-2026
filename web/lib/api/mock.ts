/**
 * Mock API client: in-memory fixtures behind the same `ApiClient` interface
 * as the live client, so screens can be built and screenshotted before the
 * backend is running.
 *
 * It applies the backend's access rules (`admin_reads.py`) so the role
 * switcher behaves as it will live: only admins and an agent's owner may
 * read its run log and usage, and cost keys are left out (not nulled) for
 * everyone else.
 *
 * `scenario` forces a state for screenshots and tests (from `?mock=`):
 * "loading" never resolves, "empty" returns nothing, "error" fails. The
 * users list ignores it so the role switcher always works.
 */

import type {
  AgentListItem,
  AgentUsage,
  CatalogItem,
  DayUsage,
  Page,
  PageParams,
  RunListEntry,
  RunStepEntry,
  UserPublic,
} from "@/lib/contracts/api";
import type { AdminQueue, BudgetOut } from "@/lib/contracts/budgets";
import { ApiError, type ApiClient } from "@/lib/api/client";
import { mockApproveSpend, mockGetBudget, mockListBudgets } from "@/lib/api/mock-budgets";
import {
  MOCK_AGENTS,
  MOCK_RUNS,
  MOCK_USERS,
  byCodepoint,
  type MockRun,
} from "@/lib/api/mock-data";

export type MockScenario = "loading" | "empty" | "error" | null;

export interface MockClientOptions {
  userId: string | null;
  /** Artificial latency so loading states are visible. */
  latencyMs?: number;
  /** Read on every call, so a forced state follows the current URL. */
  getScenario?: () => MockScenario;
}

function paginate<T>(all: T[], params: PageParams = {}): Page<T> {
  const limit = params.limit ?? 20;
  const start = params.cursor ? Number(params.cursor) : 0;
  const items = all.slice(start, start + limit);
  const next = start + limit < all.length ? String(start + limit) : null;
  return { items, next_cursor: next };
}

const forbidden = () =>
  new ApiError(403, { code: "forbidden", message: "You may not read this run log" });

function sumDecimals(values: string[]): string {
  const micros = values.reduce((sum, v) => sum + Math.round(Number(v) * 1_000_000), 0);
  return (micros / 1_000_000).toFixed(6);
}

export function createMockClient(options: MockClientOptions): ApiClient {
  const { userId, latencyMs = 250, getScenario = () => null } = options;

  function respond<T>(produce: () => T, opts: { ignoreScenario?: boolean } = {}): Promise<T> {
    const scenario = opts.ignoreScenario ? null : getScenario();
    if (scenario === "loading") return new Promise<T>(() => {});
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          if (scenario === "error") {
            throw new ApiError(500, {
              code: "internal_error",
              message: "The server hit an error. Try again in a moment.",
            });
          }
          resolve(produce());
        } catch (error) {
          reject(error);
        }
      }, latencyMs);
    });
  }

  const isEmpty = () => getScenario() === "empty";

  function caller(): UserPublic {
    if (!userId) {
      throw new ApiError(401, { code: "missing_identity", message: "Missing identity header" });
    }
    const user = MOCK_USERS.find((u) => u.id === userId);
    if (!user) throw new ApiError(401, { code: "unknown_user", message: "Unknown user" });
    return user;
  }

  function agents(): AgentListItem[] {
    return isEmpty() ? [] : [...MOCK_AGENTS].sort((a, b) => byCodepoint(a.slug, b.slug));
  }

  function getAgent(agentId: string): AgentListItem {
    const agent = MOCK_AGENTS.find((a) => a.id === agentId);
    if (!agent) throw new ApiError(404, { code: "agent_not_found", message: "Agent not found" });
    return agent;
  }

  function canReadRunLog(user: UserPublic, ownerId: string): boolean {
    return user.role === "admin" || ownerId === user.id;
  }

  /** Agent ids the caller may read, or null for every agent (admin). */
  function scope(user: UserPublic, agentId: string | null | undefined): string[] | null {
    if (agentId) {
      const agent = getAgent(agentId);
      if (!canReadRunLog(user, agent.owner_id)) throw forbidden();
      return [agent.id];
    }
    if (user.role === "admin") return null;
    if (user.role !== "builder") throw forbidden();
    return MOCK_AGENTS.filter((a) => a.owner_id === user.id).map((a) => a.id);
  }

  function runs(user: UserPublic, agentId: string | null | undefined): MockRun[] {
    const allowed = scope(user, agentId);
    if (isEmpty()) return [];
    return MOCK_RUNS.filter((r) => allowed === null || allowed.includes(r.agent_id));
  }

  function runItem(user: UserPublic, run: MockRun): RunListEntry {
    const common = {
      id: run.id,
      agent_id: run.agent_id,
      user_id: run.user_id,
      entry_point: run.entry_point,
      status: run.status,
      duration_ms: run.duration_ms,
      created_at: run.created_at,
    };
    return canReadRunLog(user, getAgent(run.agent_id).owner_id)
      ? { ...common, cost_total: run.cost_total }
      : common;
  }

  function requireAdmin(user: UserPublic) {
    if (user.role !== "admin") {
      throw new ApiError(403, { code: "forbidden", message: "Only admins can do this" });
    }
  }

  function budgetOrNotFound(agentId: string): BudgetOut {
    const budget = mockGetBudget(agentId);
    if (!budget) throw new ApiError(404, { code: "agent_not_found", message: "Agent not found" });
    return budget;
  }

  return {
    listUsers: () => respond(() => MOCK_USERS.map((u) => ({ ...u })), { ignoreScenario: true }),

    listCatalog: (params) =>
      respond(() => {
        caller();
        const live: CatalogItem[] = agents()
          .filter((a) => a.live_version_number !== null)
          .map((a) => ({
            id: a.id,
            slug: a.slug,
            name: a.name,
            description: a.description,
            owner_id: a.owner_id,
            live_version_number: a.live_version_number as number,
          }));
        return paginate(live, params);
      }),

    listAgents: (params) =>
      respond(() => {
        caller();
        return paginate(agents(), params);
      }),

    listRuns: (params = {}) =>
      respond(() => {
        const user = caller();
        return paginate(
          runs(user, params.agentId).map((r) => runItem(user, r)),
          params
        );
      }),

    getRun: (runId) =>
      respond(() => {
        const user = caller();
        const run = isEmpty() ? undefined : MOCK_RUNS.find((r) => r.id === runId);
        if (!run) throw new ApiError(404, { code: "run_not_found", message: "Run not found" });
        const full = canReadRunLog(user, getAgent(run.agent_id).owner_id);
        if (!full) throw forbidden();
        const steps: RunStepEntry[] = run.steps.map((s) => ({ ...s }));
        return { run: runItem(user, run), steps };
      }),

    getUsage: (params = {}) =>
      respond(() => {
        const user = caller();
        const scoped = runs(user, params.agentId);
        const byAgent = new Map<string, MockRun[]>();
        const byDay = new Map<string, MockRun[]>();
        for (const run of scoped) {
          byAgent.set(run.agent_id, [...(byAgent.get(run.agent_id) ?? []), run]);
          const day = run.created_at.slice(0, 10);
          byDay.set(day, [...(byDay.get(day) ?? []), run]);
        }
        const by_agent: AgentUsage[] = [...byAgent.entries()]
          .map(([agentId, list]) => ({
            agent_id: agentId,
            agent_name: getAgent(agentId).name,
            runs: list.length,
            cost: sumDecimals(list.map((r) => r.cost_total)),
          }))
          .sort((a, b) =>
            a.agent_name === b.agent_name
              ? byCodepoint(a.agent_id, b.agent_id)
              : byCodepoint(a.agent_name, b.agent_name)
          );
        const by_day: DayUsage[] = [...byDay.entries()]
          .map(([day, list]) => ({
            day,
            runs: list.length,
            cost: sumDecimals(list.map((r) => r.cost_total)),
          }))
          .sort((a, b) => byCodepoint(a.day, b.day));
        return { by_agent, by_day };
      }),

    getBudget: (agentId) =>
      respond(() => {
        const user = caller();
        const budget = budgetOrNotFound(agentId);
        if (user.role !== "admin" && getAgent(agentId).owner_id !== user.id) {
          throw new ApiError(403, {
            code: "forbidden",
            message: "Only the owner or an admin can see this budget",
          });
        }
        return budget;
      }),

    approveSpend: (agentId, amount) =>
      respond(() => {
        requireAdmin(caller());
        budgetOrNotFound(agentId);
        const approved = mockApproveSpend(agentId, amount ? Number(amount) : null);
        return budgetOrNotFound(approved?.agent_id ?? agentId);
      }),

    listBudgets: () =>
      respond(() => {
        requireAdmin(caller());
        return { items: isEmpty() ? [] : mockListBudgets() };
      }),

    getAdminQueue: () =>
      respond((): AdminQueue => {
        requireAdmin(caller());
        const items = isEmpty() ? [] : mockListBudgets();
        return {
          items: items
            .filter((b) => b.state === "paused")
            .map((b) => ({
              kind: "budget_pause" as const,
              agent_id: b.agent_id,
              agent_name: b.agent_name,
              spent: b.spent,
              cap: b.cap,
              extra_allowance: b.extra_allowance,
              cap_total: b.cap_total,
              since: b.updated_at,
            })),
        };
      }),
  };
}
