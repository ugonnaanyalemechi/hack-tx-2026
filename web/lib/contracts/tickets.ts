/**
 * Ticket contract: the flag tickets an admin or agent owner works through.
 *
 * Mirrors `src/hack_tx_2026/models/tickets.py` (TicketListItem, TicketDetail,
 * SaveAsTestCaseRequest) and `EvalCaseOut` from `models/evals.py`, field for
 * field. Lives in its own file so it is additive to `api.ts`; fold it in
 * there when convenient. No cost fields: tickets never carry cost.
 */

import type { IsoDateTime } from "@/lib/contracts/api";

export type TicketStatus = "open" | "resolved";

/** `GET /v1/tickets` item. */
export interface TicketListItem {
  id: string;
  agent_id: string;
  agent_name: string;
  run_id: string;
  /** Null until the re-check run for this flag has been attached. */
  recheck_run_id: string | null;
  question: string;
  status: TicketStatus;
  created_by: string;
  created_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
}

/** `GET /v1/tickets/{id}` and the body of `POST .../resolve`. */
export interface TicketDetail extends TicketListItem {
  answer: string;
  note: string | null;
  created_by_name: string | null;
}

/** Body of `POST /v1/tickets/{id}/save-as-test-case`. */
export interface SaveAsTestCaseRequest {
  expected_strings: string[];
  citation_required: boolean;
  rubric: string | null;
}

/** Where an eval case came from: written by hand, or saved from a flag ticket. */
export type EvalCaseOrigin = "manual" | "flag";

/** Response (201) of `POST /v1/tickets/{id}/save-as-test-case`. */
export interface EvalCaseOut {
  id: string;
  agent_id: string;
  question: string;
  expected_strings: string[];
  citation_required: boolean;
  rubric: string | null;
  /** A ticket always saves "flag". */
  origin: EvalCaseOrigin;
  created_at: IsoDateTime;
}
