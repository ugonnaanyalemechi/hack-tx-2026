/** Chat-page domain types. These are UI-side shapes built from StreamEvents
 * and mock seed data — not part of the backend contract (see
 * lib/contracts/events.ts for that). Never include cost or token-count
 * fields here: this page is an end-user view and the app has a strict
 * cost-omission rule for non-admin views. */

export interface Agent {
  id: string;
  name: string;
  ownerName: string;
}

export interface ToolNote {
  /** StreamEvent tool name, e.g. "search_filings". The UI maps this to a
   * quiet human label ("Searching filings" / "Searched filings"). */
  name: string;
  /** Known once tool_result arrives; renders as "(1.4s)". */
  seconds?: number;
  /** "running" while tool_call has fired but tool_result hasn't yet. */
  status: "running" | "done";
}

/** The user's answer to an approval card. */
export type ApprovalDecision = "approve" | "reject";

/** A side-effect tool call waiting on (or past) the user's decision. Built
 * from the approval_required stream event. */
export interface ApprovalRequest {
  /** approval_id from the stream; the decide call is keyed on it. */
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** "deciding" while the decide call is in flight, before its stream
   * starts; "approved"/"rejected" once the backend accepted the decision. */
  status: "pending" | "deciding" | "approved" | "rejected";
  /** The button pressed, so the card can show which one is in flight. */
  decision?: ApprovalDecision;
  /** Set when the decide call failed before its stream started. */
  error?: string;
}

/**
 * Where a flagged answer is in its re-check. Client-side only: the spec
 * (#10, flow 4) says flagging "streams the re-check", but the backend has
 * no flag route or flag-specific event yet (runtime #30). The re-check is
 * assumed to stream ordinary StreamEvents (run_started ... message_complete
 * ... run_finished), so no shared contract changes.
 */
// RUNTIME-PLACEHOLDER(#30): client-side stand-in for the flag/re-check state, since the backend has no flag route or event yet. Replace with the real flag response and event shape once #30 lands.
export interface FlagState {
  /** "flagging" while the flag call is in flight, before its stream starts. */
  status: "flagging" | "rechecking" | "rechecked" | "error";
  /** Set when the flag call failed before its stream started. */
  error?: string;
}

export type ChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      /** Final guarded text. Undefined while still streaming. */
      text: string | null;
      /** Live token preview; must never be shown once `text` is set. */
      preview: string;
      toolNote?: ToolNote;
      citations?: string[];
      guardNote?: string;
      /** Set when this run stopped at a side-effect tool for approval. */
      approval?: ApprovalRequest;
      /** Set once the user flags this answer. */
      flag?: FlagState;
      /** Set on a re-check answer: the id of the flagged message it follows. */
      // RUNTIME-PLACEHOLDER(#30): the real re-check is a recheck run linked to the ticket (recheck_run_id), not to a chat message. Replace this link once #30 and the thread read (#15) define how a re-check message is stored.
      recheckOf?: string;
      /** Set when the run ended in error instead of a completed message. */
      error?: { code: string; message: string };
      status: "streaming" | "done" | "error";
      createdAt: string;
    };

export interface ChatSummary {
  id: string;
  title: string;
  relativeLabel: string;
  updatedAt: string;
  messages: ChatMessage[];
}
