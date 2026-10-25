"""Run and run-step records: the full-fidelity usage ledger shape.

These always carry cost; the API layer (models/api.py) defines the
cost-omitting response shapes shown to callers who aren't an admin or the
agent's owner.
"""

import datetime as dt
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel

EntryPoint = Literal["chat", "api", "recheck", "eval"]
RunStatus = Literal["running", "awaiting_approval", "paused", "completed", "failed"]
StepKind = Literal["model", "tool", "approval", "guard"]


class RunRecord(BaseModel):
    id: str
    agent_id: str
    agent_version_id: str
    thread_id: str | None
    user_id: str
    entry_point: EntryPoint
    status: RunStatus
    cost_total: Decimal
    created_at: dt.datetime
    finished_at: dt.datetime | None


class RunStepRecord(BaseModel):
    id: str
    run_id: str
    sequence: int
    kind: StepKind
    name: str
    input: dict | None
    output: dict | None
    input_tokens: int | None
    cached_input_tokens: int | None
    output_tokens: int | None
    cost: Decimal | None
    latency_ms: int | None
    error: str | None
    created_at: dt.datetime
