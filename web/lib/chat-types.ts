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
      /** Set when the run stopped because the agent hit its budget. The
       * saved message stays; Continue resumes it. */
      paused?: boolean;
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
