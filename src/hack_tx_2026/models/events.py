"""Chat stream events.

Every chat call returns an SSE stream that starts with run_started and ends
with run_finished — no exceptions. The guard runs before message_complete,
so the UI must always replace the streamed token preview with the final
guarded text.

run_finished.status is what actually tells the client how the run ended;
treat it as the one thing to switch on, not "which event arrived last":

- completed: message_complete already carried the final text.
- awaiting_approval: approval_required already carried the approval_id —
  immediately followed by this run_finished, then the connection closes.
  Nothing else follows in this stream; resuming is a new call (resume).
- paused: budget_paused already carried the agent_id — immediately
  followed by this run_finished, then the connection closes. Resuming
  (Continue) is a new call.
- failed: error already carried the code/message — error is always
  immediately followed by this run_finished.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

RunFinishedStatus = Literal["completed", "awaiting_approval", "paused", "failed"]


class RunStartedEvent(BaseModel):
    type: Literal["run_started"] = "run_started"
    run_id: str


class TokenEvent(BaseModel):
    """A preview-only token; the UI must not treat this as final text."""

    type: Literal["token"] = "token"
    text: str


class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    name: str
    input: dict


class ToolResultEvent(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    name: str
    output: dict


class ApprovalRequiredEvent(BaseModel):
    """Always immediately followed by run_finished(status="awaiting_approval"),
    then the connection closes. No more tokens follow in this stream."""

    type: Literal["approval_required"] = "approval_required"
    approval_id: str
    tool_name: str
    tool_input: dict


class BudgetPausedEvent(BaseModel):
    """Always immediately followed by run_finished(status="paused"), then
    the connection closes. No more tokens follow in this stream."""

    type: Literal["budget_paused"] = "budget_paused"
    agent_id: str


class BudgetWarningEvent(BaseModel):
    """Sent once, before run_finished (and before any error or budget_paused),
    in the run whose spend takes the agent past its budget's warning fraction.
    Carries no amounts: cost is never shown to end users (#61)."""

    type: Literal["budget_warning"] = "budget_warning"
    agent_id: str


class GuardNoteEvent(BaseModel):
    type: Literal["guard_note"] = "guard_note"
    note: str


class MessageCompleteEvent(BaseModel):
    type: Literal["message_complete"] = "message_complete"
    text: str


class RunFinishedEvent(BaseModel):
    type: Literal["run_finished"] = "run_finished"
    status: RunFinishedStatus


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str


StreamEvent = Annotated[
    RunStartedEvent
    | TokenEvent
    | ToolCallEvent
    | ToolResultEvent
    | ApprovalRequiredEvent
    | BudgetPausedEvent
    | BudgetWarningEvent
    | GuardNoteEvent
    | MessageCompleteEvent
    | RunFinishedEvent
    | ErrorEvent,
    Field(discriminator="type"),
]
