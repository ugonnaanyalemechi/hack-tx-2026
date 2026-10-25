"""Chat stream events.

Every chat call returns an SSE stream that starts with run_started and ends
with run_finished. The guard runs before message_complete, so the UI must
always replace the streamed token preview with the final guarded text.
error is always followed by run_finished.
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
    """Terminal for the stream: the stream ends after this event."""

    type: Literal["approval_required"] = "approval_required"
    approval_id: str
    tool_name: str
    tool_input: dict


class BudgetPausedEvent(BaseModel):
    type: Literal["budget_paused"] = "budget_paused"
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
    | GuardNoteEvent
    | MessageCompleteEvent
    | RunFinishedEvent
    | ErrorEvent,
    Field(discriminator="type"),
]
