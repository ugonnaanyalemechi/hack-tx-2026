"""Request/response bodies for the budget and admin queue endpoints."""

import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class BudgetOut(BaseModel):
    agent_id: str
    agent_name: str
    period_start: dt.datetime
    cap: Decimal
    warning_fraction: float
    extra_allowance: Decimal
    cap_total: Decimal
    spent: Decimal
    state: Literal["ok", "warned", "paused"]
    updated_at: dt.datetime


class BudgetList(BaseModel):
    items: list[BudgetOut]


class ApproveSpendRequest(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)


class BudgetPauseItem(BaseModel):
    kind: Literal["budget_pause"] = "budget_pause"
    agent_id: str
    agent_name: str
    spent: Decimal
    cap: Decimal
    extra_allowance: Decimal
    cap_total: Decimal
    since: dt.datetime


class BlockedDeployItem(BaseModel):
    kind: Literal["blocked_deploy"] = "blocked_deploy"
    agent_id: str
    agent_name: str
    version_number: int
    score: float
    threshold: float
    since: dt.datetime


# Admin queue entries are a discriminated union on `kind`.
QueueItem = Annotated[BudgetPauseItem | BlockedDeployItem, Field(discriminator="kind")]


class AdminQueue(BaseModel):
    items: list[QueueItem]
