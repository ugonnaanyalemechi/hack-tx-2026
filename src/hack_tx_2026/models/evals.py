"""Request/response bodies for eval cases, eval reports and the deploy gate."""

import datetime as dt

from pydantic import BaseModel, Field

from hack_tx_2026.models.registry import AgentDetail


class EvalCaseCreate(BaseModel):
    question: str
    expected_strings: list[str] = Field(default_factory=list)
    citation_required: bool = False
    rubric: str | None = None


class EvalCaseOut(BaseModel):
    id: str
    agent_id: str
    question: str
    expected_strings: list[str]
    citation_required: bool
    rubric: str | None
    origin: str
    created_at: dt.datetime


class EvalCaseList(BaseModel):
    items: list[EvalCaseOut]


class EvalCaseResult(BaseModel):
    case_id: str
    question: str
    passed: bool
    answer: str | None = None
    missing_strings: list[str] = Field(default_factory=list)
    citation_ok: bool | None = None  # None when citations are not required
    rubric_passed: bool | None = None  # None when no rubric or it was not graded
    error: str | None = None


class EvalReportOut(BaseModel):
    id: str
    agent_id: str
    version_number: int
    score: float
    threshold: float
    passed: bool
    override_reason: str | None
    per_case_results: list[EvalCaseResult]
    created_at: dt.datetime


class DeployRequest(BaseModel):
    override_reason: str | None = None


class DeployResponse(AgentDetail):
    eval_report: EvalReportOut | None = None
