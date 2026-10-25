/**
 * Fixture flag tickets for the mock API client, shaped on
 * `models/tickets.py`. Run ids point at runs in `mock-data.ts`. The list is
 * mutable module state so that resolving a ticket in the mock sticks for the
 * rest of the page session, as it would against the backend.
 *
 * All data is synthetic.
 */

import type { TicketDetail } from "@/lib/contracts/tickets";

const FILINGS = "agt_1c7e4f0a9b2d4e6f8a1b3c5d7e9f0a2b";
const POLICY = "agt_2d8f5a1b0c3e4f7a9b2c4d6e8f0a1b3c";
const PR = "agt_4f0b7c3d2e5a6b9c1d4e6f8a0b2c3d5e";

function ticket(fields: Omit<TicketDetail, "resolved_at"> & { resolved_at?: string }): TicketDetail {
  return { resolved_at: null, ...fields };
}

/** Newest first, the order `GET /v1/tickets` returns. */
export function seedMockTickets(): TicketDetail[] {
  return [
    ticket({
      id: "tkt_4a1e7c2b9d3f4e6a8b0c1d5e7f9a2b3c",
      agent_id: FILINGS,
      agent_name: "Filings Analyst",
      run_id: "run_8f2a3c9e1b7d4f0a8c6e2b5d9f1a3c7e",
      recheck_run_id: "run_8f24b8e2d6a0c4f7b1d3e5a9c2f4b6d8",
      question: "Operating margin wrong for 2024",
      answer: "Operating margin was 21.4%, up from 19.8% in fiscal 2024.",
      note: null,
      status: "open",
      created_by: "usr_end_user",
      created_by_name: "Eli End User",
      created_at: "2026-10-25T14:13:00Z",
    }),
    ticket({
      id: "tkt_3b2d8e1a7c4f4d6b9a0e2c5f7a1b3d4e",
      agent_id: FILINGS,
      agent_name: "Filings Analyst",
      run_id: "run_8f26a9c5e1b7d3f0a2c4e6b8d1f3a5c7",
      recheck_run_id: null,
      question: "Missing citation on debt table",
      answer: "Acme has $600M of notes maturing in fiscal 2027.",
      note: null,
      status: "open",
      created_by: "usr_end_user",
      created_by_name: "Eli End User",
      created_at: "2026-10-25T12:40:00Z",
    }),
    ticket({
      id: "tkt_2c3e9f2b8d5a4e7c0b1f3d6a8b2c4e5f",
      agent_id: PR,
      agent_name: "PR Reviewer",
      run_id: "run_8f29b7d1e5a3c9f0b2d4e6a8c0f1b3d5",
      recheck_run_id: null,
      question: "Duplicate Jira issue created",
      answer: "I filed an issue for the missing null check.",
      note: null,
      status: "open",
      created_by: "usr_end_user",
      created_by_name: "Eli End User",
      created_at: "2026-10-24T16:05:00Z",
    }),
    ticket({
      id: "tkt_1d4f0a3c9e6b4f8d1c2a4e7b9c3d5f6a",
      agent_id: POLICY,
      agent_name: "Policy Assistant",
      run_id: "run_8f27c1e7a3d9b5f2c4e6a8d0b1f3c5e7",
      recheck_run_id: null,
      question: "Clause quoted from the wrong policy",
      answer: "Section 4.2 of the travel policy allows this expense.",
      note: null,
      status: "open",
      created_by: "usr_end_user",
      created_by_name: "Eli End User",
      created_at: "2026-10-24T10:20:00Z",
    }),
    ticket({
      id: "tkt_0e5a1b4d0f7c4a9e2d3b5f8c0d4e6a7b",
      agent_id: FILINGS,
      agent_name: "Filings Analyst",
      run_id: "run_8f2b6d0e4a1c4b7e9d2f5a8c1e3b6d90",
      recheck_run_id: "run_8f24b8e2d6a0c4f7b1d3e5a9c2f4b6d8",
      question: "Fiscal year label off by one",
      answer: "Revenue for fiscal 2024 was $3.8B.",
      note: null,
      status: "resolved",
      created_by: "usr_end_user",
      created_by_name: "Eli End User",
      created_at: "2026-10-23T09:00:00Z",
      resolved_at: "2026-10-23T15:30:00Z",
    }),
  ];
}

export const MOCK_TICKETS: TicketDetail[] = seedMockTickets();

// ---------------------------------------------------------------------------
// Tickets filed by flagging an answer in the mock chat.
//
// RUNTIME-PLACEHOLDER(#30): the real flag call (runtime #30) files the ticket
// through platform's ticket service. Until then the mock flag files it here,
// kept in localStorage so /admin/tickets sees it after navigating or reloading.
// ---------------------------------------------------------------------------

const FILED_KEY = "foundry.mock-flag-tickets";
let filed: TicketDetail[] = [];
let filedRaw: string | null = null;

function loadFiled(): TicketDetail[] {
  try {
    const raw = window.localStorage.getItem(FILED_KEY);
    if (raw !== null && raw !== filedRaw) {
      filedRaw = raw;
      filed = JSON.parse(raw) as TicketDetail[];
    }
  } catch {
    // Blocked storage or a corrupt value: keep the in-memory copy.
  }
  return filed;
}

/** Call after changing a filed ticket in place (for example resolving it). */
export function persistFiledTickets() {
  try {
    const raw = JSON.stringify(filed);
    filedRaw = raw;
    window.localStorage.setItem(FILED_KEY, raw);
  } catch {
    // Blocked storage: this page still sees the change.
  }
}

/** Every ticket the mock knows, newest first: flagged this session, then the seeds. */
export function allMockTickets(): TicketDetail[] {
  return [...loadFiled(), ...MOCK_TICKETS];
}

let filedCounter = 0;

/** Files a ticket for a flagged answer; the re-check run is attached at once. */
export function mockFileFlagTicket(input: {
  agentId: string;
  agentName: string;
  question: string;
  answer: string;
  userId: string;
  userName: string | null;
  runId: string;
  recheckRunId: string;
}): TicketDetail {
  filedCounter += 1;
  const stamp = `${Date.now().toString(16)}${filedCounter}`.padStart(32, "0");
  const created: TicketDetail = {
    id: `tkt_${stamp}`,
    agent_id: input.agentId,
    agent_name: input.agentName,
    run_id: input.runId,
    recheck_run_id: input.recheckRunId,
    question: input.question,
    answer: input.answer,
    note: null,
    status: "open",
    created_by: input.userId,
    created_by_name: input.userName,
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
  filed = [created, ...loadFiled()];
  persistFiledTickets();
  return created;
}
