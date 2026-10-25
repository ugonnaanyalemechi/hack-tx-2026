"""Request/response bodies for the non-streaming invoke endpoint (ticket #20)."""

from pydantic import BaseModel, Field

from hack_tx_2026.models.events import RunFinishedStatus


class InvokeRequest(BaseModel):
    text: str = Field(min_length=1)


class InvokeApproval(BaseModel):
    approval_id: str
    tool_name: str
    tool_input: dict


class InvokeError(BaseModel):
    code: str
    message: str


class InvokeResponse(BaseModel):
    run_id: str
    status: RunFinishedStatus
    message: str | None = None
    guard_notes: list[str] = Field(default_factory=list)
    approval: InvokeApproval | None = None
    error: InvokeError | None = None
