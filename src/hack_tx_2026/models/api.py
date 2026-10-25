"""Shared API contract pieces: the error shape, list paging and the
cost-omission pattern used by every endpoint that is not admin/owner-only.

Per-domain request/response bodies (agents, connectors, budgets, evals,
tickets, ...) are defined by the ticket that builds that endpoint, not here.
"""

import datetime as dt
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel

from hack_tx_2026.models.records import EntryPoint, RunStatus

T = TypeVar("T")


class ErrorBody(BaseModel):
    code: str  # snake_case
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


class PageParams(BaseModel):
    limit: int = 20
    cursor: str | None = None


class Page(BaseModel, Generic[T]):  # noqa: UP046 — pydantic generics need Generic[T]
    items: list[T]
    next_cursor: str | None = None


class UserPublic(BaseModel):
    id: str
    name: str
    role: str


# --- Cost-omission pattern for run list/detail -----------------------------
#
# End users and non-owners get the *Public shapes (no cost key at all).
# Admins and the agent's owner get the matching subclass, which adds cost.


class RunListItemPublic(BaseModel):
    id: str
    agent_id: str
    user_id: str
    entry_point: EntryPoint
    status: RunStatus
    duration_ms: int | None
    created_at: dt.datetime


class RunListItem(RunListItemPublic):
    cost_total: Decimal


class RunStepPublic(BaseModel):
    id: str
    sequence: int
    kind: str
    name: str
    latency_ms: int | None
    error: str | None


class RunStep(RunStepPublic):
    cost: Decimal | None
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None


class RunDetailPublic(BaseModel):
    run: RunListItemPublic
    steps: list[RunStepPublic]


class RunDetail(BaseModel):
    run: RunListItem
    steps: list[RunStep]
