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
import type { TicketDetail, TicketListItem } from "@/lib/contracts/tickets";
import { allMockTickets, persistFiledTickets } from "@/lib/api/mock-tickets";
import {
  mockBlockedDeploys,
  mockDeployVersion,
  mockGetAgentDetail,
  mockListEvalReports,
} from "@/lib/api/mock-deploy";
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

  function respond<T>(
    produce: () => T,
    opts: { ignoreScenario?: boolean; delayMs?: number } = {}
  ): Promise<T> {
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
      }, opts.delayMs ?? latencyMs);
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

  /** Tickets the caller may see: an admin all, a builder their agents'. */
  function visibleTickets(user: UserPublic, agentId: string | null | undefined): TicketDetail[] {
    const denied = () =>
      new ApiError(403, {
        code: "forbidden",
        message: "Only the owner or an admin can see these tickets",
      });
    if (agentId) {
      const agent = getAgent(agentId);
      if (!canReadRunLog(user, agent.owner_id)) throw denied();
    } else if (user.role !== "admin" && user.role !== "builder") {
      throw denied();
    }
    return allMockTickets().filter((t) => {
      if (agentId && t.agent_id !== agentId) return false;
      return user.role === "admin" || getAgent(t.agent_id).owner_id === user.id;
    });
  }

  function loadTicket(user: UserPublic, ticketId: string): TicketDetail {
    const ticket = allMockTickets().find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiError(404, { code: "ticket_not_found", message: "Ticket not found" });
    }
    if (!canReadRunLog(user, getAgent(ticket.agent_id).owner_id)) {
      throw new ApiError(403, {
        code: "forbidden",
        message: "Only the owner or an admin can see this ticket",
      });
    }
    return ticket;
  }

  function toListItem(ticket: TicketDetail): TicketListItem {
    const { answer, note, created_by_name, ...item } = ticket;
    void answer;
    void note;
    void created_by_name;
    return item;
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

    listTickets: (params = {}) =>
      respond(() => {
        const user = caller();
        const visible = visibleTickets(user, params.agentId).filter(
          (t) => !params.status || t.status === params.status
        );
        return paginate(isEmpty() ? [] : visible.map(toListItem), params);
      }),

    getTicket: (ticketId) => respond(() => ({ ...loadTicket(caller(), ticketId) })),

    resolveTicket: (ticketId) =>
      respond(() => {
        const ticket = loadTicket(caller(), ticketId);
        if (ticket.status !== "resolved") {
          ticket.status = "resolved";
          ticket.resolved_at = new Date().toISOString();
          persistFiledTickets();
        }
        return { ...ticket };
      }),

    saveTicketAsTestCase: (ticketId, body) =>
      respond(() => {
        const ticket = loadTicket(caller(), ticketId);
        return {
          id: `evc_${ticket.id.slice(4, 12)}`,
          agent_id: ticket.agent_id,
          question: ticket.question,
          expected_strings: body.expected_strings,
          citation_required: body.citation_required,
          rubric: body.rubric,
          origin: "flag",
          created_at: new Date().toISOString(),
        };
      }),

    getAgentDetail: (agentId) =>
      respond(() => {
        caller();
        return mockGetAgentDetail(agentId, { empty: isEmpty() });
      }),

    listEvalReports: (agentId) =>
      respond(() => {
        caller();
        return mockListEvalReports(agentId, { empty: isEmpty() });
      }),

    // RUNTIME-PLACEHOLDER(#26): the delay stands in for the time a real eval run takes.
    deployVersion: (agentId, versionNumber, overrideReason) =>
      respond(() => mockDeployVersion(agentId, versionNumber, caller(), overrideReason), {
        delayMs: overrideReason ? latencyMs : 900,
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
        if (isEmpty()) return { items: [] };
        // Oldest first within a kind, like a queue; the page groups by kind.
        const pauses = mockListBudgets()
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
          }));
        const tickets = allMockTickets().filter((t) => t.status === "open")
          .map((t) => ({
            kind: "open_ticket" as const,
            ticket_id: t.id,
            agent_id: t.agent_id,
            agent_name: t.agent_name,
            question: t.question,
            since: t.created_at,
          }))
          .reverse();
        return { items: [...pauses, ...mockBlockedDeploys(), ...tickets] };
      }),
  };
}
