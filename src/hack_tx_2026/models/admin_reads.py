"""Response models for the admin reads: catalog, run detail and usage.

Run list items and run steps reuse the shared shapes in `models.api`.
"""

import datetime as dt
from decimal import Decimal

from pydantic import BaseModel

from hack_tx_2026.models.api import (
    RunListItem,
    RunListItemPublic,
    RunStep,
    RunStepPublic,
)


class CatalogItem(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    owner_id: str
    live_version_number: int


class ApprovalDecision(BaseModel):
    id: str
    tool_name: str
    status: str
    decided_by: str | None
    decided_by_name: str | None
    decided_at: dt.datetime | None


class RunStepDetail(RunStep):
    approval: ApprovalDecision | None = None


class RunStepDetailPublic(RunStepPublic):
    approval: ApprovalDecision | None = None


class RunDetailWithApprovals(BaseModel):
    run: RunListItem | RunListItemPublic
    steps: list[RunStepDetail | RunStepDetailPublic]


class AgentUsage(BaseModel):
    agent_id: str
    agent_name: str
    runs: int
    cost: Decimal


class DayUsage(BaseModel):
    day: dt.date
    runs: int
    cost: Decimal


class UsageReport(BaseModel):
    by_agent: list[AgentUsage]
    by_day: list[DayUsage]
