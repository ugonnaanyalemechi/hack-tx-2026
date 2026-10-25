/**
 * Chat stream events.
 *
 * Mirrors `src/hack_tx_2026/models/events.py` (the StreamEvent discriminated
 * union) field-for-field and discriminant-for-discriminant. The backend
 * streaming endpoint does not exist yet (separate runtime ticket) — these
 * types are the contract the mock client in `lib/mock-chat.ts` implements,
 * so the real client can be swapped in later without touching the UI.
 *
 * Every chat call returns an SSE stream that starts with run_started and
 * ends with run_finished — no exceptions. The guard runs before
 * message_complete, so the UI must always replace the streamed token
 * preview with the final guarded text.
 *
 * run_finished.status is what actually tells the client how the run ended:
 * - completed: message_complete already carried the final text.
 * - awaiting_approval: approval_required already carried the approval_id —
 *   immediately followed by this run_finished, then the connection closes.
 * - paused: budget_paused already carried the agent_id — immediately
 *   followed by this run_finished, then the connection closes.
 * - failed: error already carried the code/message — error is always
 *   immediately followed by this run_finished.
 */

export type RunFinishedStatus =
  | "completed"
  | "awaiting_approval"
  | "paused"
  | "failed";

export interface RunStartedEvent {
  type: "run_started";
  run_id: string;
}

/** A preview-only token; the UI must not treat this as final text. */
export interface TokenEvent {
  type: "token";
  text: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  name: string;
  output: Record<string, unknown>;
}

/**
 * Always immediately followed by run_finished(status="awaiting_approval"),
 * then the connection closes. No more tokens follow in this stream.
 */
export interface ApprovalRequiredEvent {
  type: "approval_required";
  approval_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/**
 * Always immediately followed by run_finished(status="paused"), then the
 * connection closes. No more tokens follow in this stream.
 */
export interface BudgetPausedEvent {
  type: "budget_paused";
  agent_id: string;
}

export interface GuardNoteEvent {
  type: "guard_note";
  note: string;
}

export interface MessageCompleteEvent {
  type: "message_complete";
  text: string;
}

export interface RunFinishedEvent {
  type: "run_finished";
  status: RunFinishedStatus;
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type StreamEvent =
  | RunStartedEvent
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequiredEvent
  | BudgetPausedEvent
  | GuardNoteEvent
  | MessageCompleteEvent
  | RunFinishedEvent
  | ErrorEvent;
