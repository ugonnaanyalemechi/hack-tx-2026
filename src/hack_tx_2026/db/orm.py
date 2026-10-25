"""ORM tables for every table in the spec's Data section.

One writer per table (see CLAUDE.md, Team and ownership):
users, agents, agent_versions, connectors, connector_grants, budgets,
eval_cases, eval_reports and tickets are written by platform; threads, runs,
run_steps and approvals are written by runtime.
"""

import datetime as dt
from decimal import Decimal

from sqlalchemy import JSON, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hack_tx_2026.db.base import Base
from hack_tx_2026.db.ids import new_id

MONEY = Numeric(precision=18, scale=6)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("usr"))
    name: Mapped[str]
    role: Mapped[str]  # admin | builder | end_user
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("agt"))
    slug: Mapped[str] = mapped_column(unique=True)
    name: Mapped[str]
    description: Mapped[str] = mapped_column(default="")
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    live_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("agent_versions.id", use_alter=True, name="fk_agents_live_version_id"),
        default=None,
    )
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)

    versions: Mapped[list["AgentVersion"]] = relationship(
        back_populates="agent", foreign_keys="AgentVersion.agent_id"
    )


class AgentVersion(Base):
    __tablename__ = "agent_versions"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("agv"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    version_number: Mapped[int]
    spec: Mapped[dict] = mapped_column(JSON)  # the parsed agent spec (see models.spec)
    status: Mapped[str] = mapped_column(default="draft")  # draft | deployed | blocked
    eval_report_id: Mapped[str | None] = mapped_column(
        ForeignKey("eval_reports.id", use_alter=True, name="fk_agent_versions_eval_report_id"),
        default=None,
    )
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)

    agent: Mapped["Agent"] = relationship(back_populates="versions", foreign_keys=[agent_id])


class Connector(Base):
    __tablename__ = "connectors"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("con"))
    name: Mapped[str] = mapped_column(unique=True)
    description: Mapped[str] = mapped_column(default="")
    tools: Mapped[list] = mapped_column(JSON)  # [{name, side_effect: bool}, ...]
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class ConnectorGrant(Base):
    __tablename__ = "connector_grants"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("grt"))
    connector_id: Mapped[str] = mapped_column(ForeignKey("connectors.id"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    granted_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    granted_at: Mapped[dt.datetime] = mapped_column(default=_now)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(default=None)


class Thread(Base):
    __tablename__ = "threads"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("thr"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(default="")
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    last_updated_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("run"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    agent_version_id: Mapped[str] = mapped_column(ForeignKey("agent_versions.id"))
    thread_id: Mapped[str | None] = mapped_column(ForeignKey("threads.id"), default=None)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    entry_point: Mapped[str]  # chat | api | recheck | eval
    status: Mapped[str] = mapped_column(
        default="running"
    )  # running | awaiting_approval | paused | completed | failed
    cost_total: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0))
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    finished_at: Mapped[dt.datetime | None] = mapped_column(default=None)


class RunStep(Base):
    __tablename__ = "run_steps"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("stp"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    sequence: Mapped[int]
    kind: Mapped[str]  # model | tool | approval | guard
    name: Mapped[str]
    input: Mapped[dict | None] = mapped_column(JSON, default=None)
    output: Mapped[dict | None] = mapped_column(JSON, default=None)
    input_tokens: Mapped[int | None] = mapped_column(default=None)
    cached_input_tokens: Mapped[int | None] = mapped_column(default=None)
    output_tokens: Mapped[int | None] = mapped_column(default=None)
    cost: Mapped[Decimal | None] = mapped_column(MONEY, default=None)
    latency_ms: Mapped[int | None] = mapped_column(default=None)
    error: Mapped[str | None] = mapped_column(default=None)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Approval(Base):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("apr"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    tool_name: Mapped[str]
    tool_input: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(default="pending")  # pending | approved | rejected
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), default=None)
    decided_at: Mapped[dt.datetime | None] = mapped_column(default=None)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Budget(Base):
    __tablename__ = "budgets"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("bud"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), unique=True)
    period_start: Mapped[dt.datetime]
    cap: Mapped[Decimal] = mapped_column(MONEY)
    warning_fraction: Mapped[float] = mapped_column(default=0.8)
    extra_allowance: Mapped[Decimal] = mapped_column(MONEY, default=Decimal(0))
    state: Mapped[str] = mapped_column(default="ok")  # ok | warned | paused
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    updated_at: Mapped[dt.datetime] = mapped_column(default=_now)


class EvalCase(Base):
    __tablename__ = "eval_cases"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("evc"))
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"))
    question: Mapped[str]
    expected_strings: Mapped[list] = mapped_column(JSON, default=list)
    citation_required: Mapped[bool] = mapped_column(default=False)
    rubric: Mapped[str | None] = mapped_column(default=None)
    origin: Mapped[str] = mapped_column(default="manual")  # manual | flag
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class EvalReport(Base):
    __tablename__ = "eval_reports"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("evr"))
    agent_version_id: Mapped[str] = mapped_column(ForeignKey("agent_versions.id"))
    score: Mapped[float]
    threshold: Mapped[float]
    passed: Mapped[bool]
    override_reason: Mapped[str | None] = mapped_column(default=None)
    per_case_results: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("tkt"))
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"))
    question: Mapped[str]
    answer: Mapped[str]
    note: Mapped[str | None] = mapped_column(default=None)
    status: Mapped[str] = mapped_column(default="open")  # open | resolved
    recheck_run_id: Mapped[str | None] = mapped_column(ForeignKey("runs.id"), default=None)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[dt.datetime] = mapped_column(default=_now)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(default=None)
