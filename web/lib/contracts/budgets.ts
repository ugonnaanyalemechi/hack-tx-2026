/**
 * Budget API contract: the per-agent budget, the admin's approve-spend
 * action, the all-agents budget list and the admin queue.
 *
 * Mirrors, field for field, `src/hack_tx_2026/models/budgets.py`. Money
 * arrives as six-place decimal strings, datetimes as ISO 8601 UTC.
 *
 * Cost figures are admin and owner only. End-user screens must never render
 * anything from `BudgetOut` other than `state`.
 */

import type { DecimalString, IsoDateTime } from "@/lib/contracts/api";

/** ok below the warning fraction, warned from it, paused at the cap. */
export type BudgetState = "ok" | "warned" | "paused";

export interface BudgetOut {
  agent_id: string;
  agent_name: string;
  period_start: IsoDateTime;
  cap: DecimalString;
  warning_fraction: number;
  extra_allowance: DecimalString;
  cap_total: DecimalString;
  spent: DecimalString;
  state: BudgetState;
  updated_at: IsoDateTime;
}

export interface BudgetList {
  items: BudgetOut[];
}

/** `POST /v1/agents/{id}/budget/approve` body; no amount grants one more base cap. */
export interface ApproveSpendRequest {
  amount?: DecimalString | null;
}

export interface BudgetPauseItem {
  kind: "budget_pause";
  agent_id: string;
  agent_name: string;
  spent: DecimalString;
  cap: DecimalString;
  extra_allowance: DecimalString;
  cap_total: DecimalString;
  since: IsoDateTime;
}

export interface BlockedDeployItem {
  kind: "blocked_deploy";
  agent_id: string;
  agent_name: string;
  version_number: number;
  score: number;
  threshold: number;
  since: IsoDateTime;
}

export interface OpenTicketItem {
  kind: "open_ticket";
  ticket_id: string;
  agent_id: string;
  agent_name: string;
  question: string;
  since: IsoDateTime;
}

export type QueueItem = BudgetPauseItem | BlockedDeployItem | OpenTicketItem;

export interface AdminQueue {
  items: QueueItem[];
}
