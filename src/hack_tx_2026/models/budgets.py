"""Request/response bodies for the budget and admin queue endpoints."""

import datetime as dt
from decimal import Decimal
from typing import Literal

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


# Eval gate ticket #27 will add a BlockedDeployItem (kind "blocked_deploy")
# and turn this alias into a discriminated union on `kind`.
QueueItem = BudgetPauseItem


class AdminQueue(BaseModel):
    items: list[QueueItem]
