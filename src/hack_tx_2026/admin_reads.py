"""Admin reads: catalog, run log, run detail and usage (story 66 access rule)."""

import base64
import datetime as dt
from collections import defaultdict
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Agent, AgentVersion, Approval, Run, RunStep, User
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.admin_reads import (
    AgentUsage,
    ApprovalDecision,
    CatalogItem,
    DayUsage,
    RunDetailWithApprovals,
    RunStepDetail,
    RunStepDetailPublic,
    UsageReport,
)
from hack_tx_2026.models.api import Page, RunListItem, RunListItemPublic

COST_QUANTUM = Decimal("0.000001")


def can_read_run_log(user: CurrentUser, agent_owner_id: str) -> bool:
    return user.role == "admin" or agent_owner_id == user.id


def _forbidden() -> ApiError:
    return ApiError(403, "forbidden", "You may not read this run log")


def _get_agent(session: Session, agent_id: str) -> Agent:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    return agent


def _utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode()


def _unb64(cursor: str) -> str:
    try:
        return base64.b64decode(cursor.encode(), altchars=b"-_", validate=True).decode()
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


# --- catalog ----------------------------------------------------------------


def list_catalog(session: Session, limit: int, cursor: str | None) -> Page[CatalogItem]:
    stmt = (
        select(Agent, AgentVersion.version_number)
        .join(AgentVersion, AgentVersion.id == Agent.live_version_id)
        .order_by(Agent.slug)
        .limit(limit + 1)
    )
    if cursor:
        stmt = stmt.where(Agent.slug > _unb64(cursor))
    rows = list(session.execute(stmt).all())
    page_rows = rows[:limit]
    items = [
        CatalogItem(
            id=a.id,
            slug=a.slug,
            name=a.name,
            description=a.description,
            owner_id=a.owner_id,
            live_version_number=number,
        )
        for a, number in page_rows
    ]
    next_cursor = _b64(page_rows[-1][0].slug) if len(rows) > limit else None
    return Page[CatalogItem](items=items, next_cursor=next_cursor)


# --- runs -------------------------------------------------------------------


def _run_item(user: CurrentUser, run: Run, owner_id: str) -> RunListItem | RunListItemPublic:
    duration = (
        None
        if run.finished_at is None
        else int((_utc(run.finished_at) - _utc(run.created_at)).total_seconds() * 1000)
    )
    common: dict[str, Any] = {
        "id": run.id,
        "agent_id": run.agent_id,
        "user_id": run.user_id,
        "entry_point": run.entry_point,
        "status": run.status,
        "duration_ms": duration,
        "created_at": _utc(run.created_at),
    }
    if can_read_run_log(user, owner_id):
        return RunListItem(**common, cost_total=run.cost_total)
    return RunListItemPublic(**common)


def _decode_run_cursor(cursor: str) -> tuple[dt.datetime, str]:
    try:
        stamp, run_id = _unb64(cursor).split("|", 1)
        return _utc(dt.datetime.fromisoformat(stamp)), run_id
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


def _db_dt(value: dt.datetime) -> dt.datetime:
    """Match the column's timezone-awareness for comparisons."""
    if Run.__table__.c.created_at.type.timezone:  # type: ignore[attr-defined]
        return value
    return value.replace(tzinfo=None)


def _scope_agent_ids(session: Session, user: CurrentUser, agent_id: str | None) -> list[str] | None:
    """Agent ids the caller may read, or None for 'all agents' (admin, no filter)."""
    if agent_id is not None:
        agent = _get_agent(session, agent_id)
        if not can_read_run_log(user, agent.owner_id):
            raise _forbidden()
        return [agent.id]
    if user.role == "admin":
        return None
    if user.role != "builder":
        raise _forbidden()
    return list(session.scalars(select(Agent.id).where(Agent.owner_id == user.id)))


def list_runs(
    session: Session,
    user: CurrentUser,
    agent_id: str | None,
    limit: int,
    cursor: str | None,
) -> Page[RunListItem | RunListItemPublic]:
    scope = _scope_agent_ids(session, user, agent_id)
    stmt = (
        select(Run, Agent.owner_id)
        .join(Agent, Agent.id == Run.agent_id)
        .order_by(Run.created_at.desc(), Run.id.desc())
        .limit(limit + 1)
    )
    if scope is not None:
        stmt = stmt.where(Run.agent_id.in_(scope))
    if cursor:
        stamp, run_id = _decode_run_cursor(cursor)
        stamp_db = _db_dt(stamp)
        stmt = stmt.where(
            or_(Run.created_at < stamp_db, and_(Run.created_at == stamp_db, Run.id < run_id))
        )
    rows = list(session.execute(stmt).all())
    page_rows = rows[:limit]
    items = [_run_item(user, run, owner_id) for run, owner_id in page_rows]
    next_cursor = None
    if len(rows) > limit:
        last = page_rows[-1][0]
        next_cursor = _b64(f"{_utc(last.created_at).isoformat()}|{last.id}")
    return Page[RunListItem | RunListItemPublic](items=items, next_cursor=next_cursor)


def _approval_for_steps(
    session: Session, run_id: str, steps: list[RunStep]
) -> dict[str, ApprovalDecision]:
    approvals = list(
        session.scalars(
            select(Approval)
            .where(Approval.run_id == run_id)
            .order_by(Approval.created_at, Approval.id)
        )
    )
    by_id = {a.id: a for a in approvals}
    approval_steps = [s for s in steps if s.kind == "approval"]
    names = {
        u.id: u.name
        for u in session.scalars(
            select(User).where(User.id.in_([a.decided_by for a in approvals if a.decided_by]))
        )
    }

    def decision(a: Approval) -> ApprovalDecision:
        return ApprovalDecision(
            id=a.id,
            tool_name=a.tool_name,
            status=a.status,
            decided_by=a.decided_by,
            decided_by_name=names.get(a.decided_by) if a.decided_by else None,
            decided_at=_utc(a.decided_at) if a.decided_at else None,
        )

    result: dict[str, ApprovalDecision] = {}
    unmatched: list[RunStep] = []
    for step in approval_steps:
        ref = step.input.get("approval_id") if isinstance(step.input, dict) else None
        if ref is not None:
            if ref in by_id:
                result[step.id] = decision(by_id[ref])
        else:
            unmatched.append(step)
    # Steps without an explicit reference pair up, in order, with approvals
    # that no step referenced explicitly.
    referenced = {d.id for d in result.values()}
    remaining = [a for a in approvals if a.id not in referenced]
    for step, approval in zip(unmatched, remaining, strict=False):
        result[step.id] = decision(approval)
    return result


def get_run_detail(session: Session, user: CurrentUser, run_id: str) -> RunDetailWithApprovals:
    run = session.get(Run, run_id)
    if run is None:
        raise ApiError(404, "run_not_found", "Run not found")
    agent = _get_agent(session, run.agent_id)
    if not can_read_run_log(user, agent.owner_id):
        raise _forbidden()
    steps = list(
        session.scalars(select(RunStep).where(RunStep.run_id == run.id).order_by(RunStep.sequence))
    )
    approvals = _approval_for_steps(session, run.id, steps)
    full = can_read_run_log(user, agent.owner_id)
    out: list[RunStepDetail | RunStepDetailPublic] = []
    for s in steps:
        common: dict[str, Any] = {
            "id": s.id,
            "sequence": s.sequence,
            "kind": s.kind,
            "name": s.name,
            "latency_ms": s.latency_ms,
            "error": s.error,
            "approval": approvals.get(s.id),
        }
        if full:
            out.append(
                RunStepDetail(
                    **common,
                    cost=s.cost,
                    input_tokens=s.input_tokens,
                    cached_input_tokens=s.cached_input_tokens,
                    output_tokens=s.output_tokens,
                )
            )
        else:
            out.append(RunStepDetailPublic(**common))
    return RunDetailWithApprovals(run=_run_item(user, run, agent.owner_id), steps=out)


# --- usage ------------------------------------------------------------------


def _q(value: Decimal) -> Decimal:
    return value.quantize(COST_QUANTUM)


def get_usage(session: Session, user: CurrentUser, agent_id: str | None) -> UsageReport:
    scope = _scope_agent_ids(session, user, agent_id)
    stmt = select(Run, Agent.name).join(Agent, Agent.id == Run.agent_id)
    if scope is not None:
        stmt = stmt.where(Run.agent_id.in_(scope))
    agent_runs: dict[str, int] = defaultdict(int)
    agent_cost: dict[str, Decimal] = defaultdict(Decimal)
    agent_names: dict[str, str] = {}
    day_runs: dict[dt.date, int] = defaultdict(int)
    day_cost: dict[dt.date, Decimal] = defaultdict(Decimal)
    for run, name in session.execute(stmt).all():
        agent_names[run.agent_id] = name
        agent_runs[run.agent_id] += 1
        agent_cost[run.agent_id] += run.cost_total
        day = _utc(run.created_at).date()
        day_runs[day] += 1
        day_cost[day] += run.cost_total
    by_agent = [
        AgentUsage(
            agent_id=a, agent_name=agent_names[a], runs=agent_runs[a], cost=_q(agent_cost[a])
        )
        for a in sorted(agent_names, key=lambda a: (agent_names[a], a))
    ]
    by_day = [DayUsage(day=d, runs=day_runs[d], cost=_q(day_cost[d])) for d in sorted(day_runs)]
    return UsageReport(by_agent=by_agent, by_day=by_day)
