"""Request/response bodies for the chat endpoints (ticket #15). The stream
itself is models/events.py."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints


class ThreadOut(BaseModel):
    id: str
    agent_id: str
    title: str
    created_at: dt.datetime
    last_updated_at: dt.datetime


class MessageOut(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    created_at: dt.datetime
    # The run that wrote an assistant message, so the UI can flag it (#30).
    # Always null on user messages.
    run_id: str | None = None


class SendMessageRequest(BaseModel):
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class DecisionRequest(BaseModel):
    """Body of POST /v1/approvals/{approval_id}/decision (ticket #24)."""

    decision: Literal["approve", "reject"]


class FlagRequest(BaseModel):
    """`POST /v1/runs/{run_id}/flag` takes an empty body (#30)."""
