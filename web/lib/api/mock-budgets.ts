/**
 * In-memory (and tab-shared) budget fixtures for the mock layer.
 *
 * Both the mock API client (the admin's budget view and approve-spend) and
 * the mock chat (the end user's warning, pause and Continue) read this one
 * store, so approving spend on the admin screen in one tab lets the paused
 * chat in another tab continue, the way the real backend will behave.
 *
 * The state rules mirror `src/hack_tx_2026/budgets.py`: paused at the cap
 * (cap plus any approved extra allowance), warned from the warning fraction.
 * Approving with no amount grants one more base cap. Values persist in
 * localStorage (when allowed) so other tabs and reloads see them.
 */

import type { BudgetOut, BudgetState } from "@/lib/contracts/budgets";
import { MOCK_AGENTS, byCodepoint } from "@/lib/api/mock-data";

const STORAGE_KEY = "foundry.mock-budgets";
const CHANGE_EVENT = "foundry:mock-budgets-change";
const PERIOD_START = "2026-10-01T00:00:00Z";
const WARNING_FRACTION = 0.8;
const MICRO = 1_000_000;

/** Stored per agent. Money is held in micro-dollars to keep sums exact. */
interface StoredBudget {
  cap: number;
  extra: number;
  spent: number;
  updatedAt: string;
}

type Store = Record<string, StoredBudget>;

/** Seeded to match docs/design/admin_budgets_approvals_tickets.png. */
const SEED: { slug: string; cap: number; spent: number }[] = [
  { slug: "market-summary", cap: 50, spent: 50 },
  { slug: "filings-analyst", cap: 50, spent: 41.2 },
  { slug: "pr-reviewer", cap: 60, spent: 22.1 },
  { slug: "policy-assistant", cap: 40, spent: 9.8 },
  { slug: "campaign-copy-reviewer", cap: 30, spent: 4 },
];

function seedStore(): Store {
  const store: Store = {};
  for (const row of SEED) {
    const agent = MOCK_AGENTS.find((a) => a.slug === row.slug);
    if (!agent) continue;
    store[agent.id] = {
      cap: row.cap * MICRO,
      extra: 0,
      spent: Math.round(row.spent * MICRO),
      updatedAt: "2026-10-25T12:00:00Z",
    };
  }
  return store;
}

let memory: Store = seedStore();
let cachedRaw: string | null = null;

function load(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return memory;
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      memory = JSON.parse(raw) as Store;
    }
  } catch {
    // Blocked storage or a corrupt value: keep the in-memory copy.
  }
  return memory;
}

function save(store: Store) {
  memory = store;
  try {
    const raw = JSON.stringify(store);
    cachedRaw = raw;
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Blocked storage: other tabs will not see the change, this one does.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function stateOf(row: StoredBudget): BudgetState {
  const total = row.cap + row.extra;
  if (row.spent >= total) return "paused";
  if (row.spent >= total * WARNING_FRACTION) return "warned";
  return "ok";
}

const dollars = (micro: number) => (micro / MICRO).toFixed(6);

function toOut(agentId: string, row: StoredBudget): BudgetOut {
  const agent = MOCK_AGENTS.find((a) => a.id === agentId);
  return {
    agent_id: agentId,
    agent_name: agent?.name ?? agentId,
    period_start: PERIOD_START,
    cap: dollars(row.cap),
    warning_fraction: WARNING_FRACTION,
    extra_allowance: dollars(row.extra),
    cap_total: dollars(row.cap + row.extra),
    spent: dollars(row.spent),
    state: stateOf(row),
    updated_at: row.updatedAt,
  };
}

/** Every budgeted agent, in name order like `GET /v1/admin/budgets`. */
export function mockListBudgets(): BudgetOut[] {
  return Object.entries(load())
    .map(([id, row]) => toOut(id, row))
    .sort((a, b) =>
      a.agent_name === b.agent_name
        ? byCodepoint(a.agent_id, b.agent_id)
        : byCodepoint(a.agent_name, b.agent_name)
    );
}

export function mockGetBudget(agentId: string): BudgetOut | null {
  const row = load()[agentId];
  return row ? toOut(agentId, row) : null;
}

/** Raise the month's allowance; no amount means one more base cap. */
export function mockApproveSpend(agentId: string, amount?: number | null): BudgetOut | null {
  const store = { ...load() };
  const row = store[agentId];
  if (!row) return null;
  const grant = amount ? Math.round(amount * MICRO) : row.cap;
  store[agentId] = { ...row, extra: row.extra + grant, updatedAt: new Date().toISOString() };
  save(store);
  return toOut(agentId, store[agentId]);
}

/** Preview helper (the chat's `?budget=`): put spend at a share of the cap. */
export function mockSetSpendShare(agentId: string, share: number) {
  const store = { ...load() };
  const row = store[agentId];
  if (!row) return;
  store[agentId] = {
    ...row,
    extra: 0,
    spent: Math.round(row.cap * share),
    updatedAt: new Date().toISOString(),
  };
  save(store);
}

/** Spend reaching the cap: what a run that crosses 100% does. */
export function mockPauseAtCap(agentId: string) {
  const store = { ...load() };
  const row = store[agentId];
  if (!row || stateOf(row) === "paused") return;
  store[agentId] = { ...row, spent: row.cap + row.extra, updatedAt: new Date().toISOString() };
  save(store);
}

/**
 * Just the state, for end-user screens (no cost figures).
 *
 * RUNTIME-PLACEHOLDER(#22): end users cannot read `GET /agents/{id}/budget`
 * (owner and admin only), and no stream event announces the 80% warning, so
 * the chat reads the mock store directly. Replaced by whatever end-user-safe
 * budget signal the runtime ticket defines.
 */
export function mockBudgetState(agentId: string): BudgetState {
  const row = load()[agentId];
  return row ? stateOf(row) : "ok";
}

export function subscribeMockBudgets(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
