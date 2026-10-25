"""Request/response bodies for the ticket endpoints. No cost fields."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class TicketListItem(BaseModel):
    id: str
    agent_id: str
    agent_name: str
    run_id: str
    recheck_run_id: str | None
    question: str
    status: Literal["open", "resolved"]
    created_by: str
    created_at: dt.datetime
    resolved_at: dt.datetime | None


class TicketDetail(TicketListItem):
    answer: str
    note: str | None
    created_by_name: str | None


class SaveAsTestCaseRequest(BaseModel):
    expected_strings: list[str] = Field(default_factory=list)
    citation_required: bool = False
    rubric: str | None = None
