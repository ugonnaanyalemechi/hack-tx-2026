"""Budget service: monthly spend, warning/pause state and admin approvals.

The single writer of the budgets table. The YAML spec is the source of truth
for the cap and warning fraction; only `extra_allowance` is stored state.
Money is Decimal quantized to 6 places. Functions flush; callers commit.
"""

import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Agent, AgentVersion, Budget, Run
from hack_tx_2026.errors import ApiError
from hack_tx_2026.models.budgets import (
    AdminQueue,
    BudgetOut,
    BudgetPauseItem,
)

QUANT = Decimal("0.000001")
ZERO = Decimal(0)


def _money(value: Decimal | float | str) -> Decimal:
    return Decimal(str(value)).quantize(QUANT)


def current_period_start(now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.now(dt.UTC)
    return now.astimezone(dt.UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _spec_version(session: Session, agent: Agent) -> AgentVersion | None:
    """The live version's spec, else the latest version's."""
    if agent.live_version_id:
        live = session.get(AgentVersion, agent.live_version_id)
        if live is not None:
            return live
    return session.scalar(
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent.id)
        .order_by(AgentVersion.version_number.desc())
        .limit(1)
    )


def _spec_budget(session: Session, agent: Agent) -> tuple[Decimal, float]:
    version = _spec_version(session, agent)
    if version is None:
        raise LookupError(f"agent {agent.id} has no versions")
    spec: dict[str, Any] = version.spec["budget"]
    return _money(spec["monthly_cap"]), float(spec.get("warning_fraction", 0.8))


def _spent(session: Session, agent_id: str, period_start: dt.datetime) -> Decimal:
    total = session.scalar(
        select(func.coalesce(func.sum(Run.cost_total), 0)).where(
            Run.agent_id == agent_id, Run.created_at >= period_start
        )
    )
    return _money(total or ZERO)


def _state(spent: Decimal, cap_total: Decimal, warning_fraction: float) -> str:
    if spent >= cap_total:
        return "paused"
    if spent >= cap_total * Decimal(str(warning_fraction)):
        return "warned"
    return "ok"


def _sync_row(session: Session, agent: Agent, cap: Decimal, fraction: float) -> Budget:
    """Fetch (or lazily create) the budget row, synced with the spec and period."""
    period = current_period_start()
    row = session.scalar(select(Budget).where(Budget.agent_id == agent.id))
    if row is None:
        row = Budget(
            agent_id=agent.id,
            period_start=period,
            cap=cap,
            warning_fraction=fraction,
            extra_allowance=ZERO,
            state="ok",
        )
        session.add(row)
    row.cap = cap
    row.warning_fraction = fraction
    if row.period_start < period:
        row.period_start = period
        row.extra_allowance = ZERO
    return row


def _to_out(agent: Agent, row: Budget, spent: Decimal) -> BudgetOut:
    cap_total = _money(row.cap) + _money(row.extra_allowance)
    return BudgetOut(
        agent_id=agent.id,
        agent_name=agent.name,
        period_start=row.period_start,
        cap=_money(row.cap),
        warning_fraction=row.warning_fraction,
        extra_allowance=_money(row.extra_allowance),
        cap_total=cap_total,
        spent=spent,
        state=row.state,  # type: ignore[arg-type]
        updated_at=row.updated_at,
    )


def _recompute(session: Session, agent: Agent) -> BudgetOut:
    cap, fraction = _spec_budget(session, agent)
    row = _sync_row(session, agent, cap, fraction)
    spent = _spent(session, agent.id, row.period_start)
    new_state = _state(spent, _money(row.cap) + _money(row.extra_allowance), fraction)
    if new_state != row.state:
        row.state = new_state
        row.updated_at = dt.datetime.now(dt.UTC)
    session.flush()
    return _to_out(agent, row, spent)


def _agent_or_lookup_error(session: Session, agent_id: str) -> Agent:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise LookupError(f"agent {agent_id} not found")
    return agent


def check_budget(session: Session, agent_id: str) -> BudgetOut:
    """Recompute and persist an agent's budget. Raises LookupError if the
    agent does not exist or has no versions. Used by the runtime seam."""
    return _recompute(session, _agent_or_lookup_error(session, agent_id))


def get_budget(session: Session, agent_id: str) -> BudgetOut:
    """HTTP variant of check_budget: unknown agent is a 404."""
    try:
        out = check_budget(session, agent_id)
    except LookupError:
        raise ApiError(404, "agent_not_found", "Agent not found") from None
    session.commit()
    return out


def owner_id(session: Session, agent_id: str) -> str:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    return agent.owner_id


def approve_extra_spend(session: Session, agent_id: str, amount: Decimal | None) -> BudgetOut:
    """Raise the month's allowance by `amount` (default: one more base cap)."""
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    try:
        current = _recompute(session, agent)
    except LookupError:
        raise ApiError(404, "agent_not_found", "Agent not found") from None
    grant = _money(amount) if amount is not None else current.cap
    row = session.scalar(select(Budget).where(Budget.agent_id == agent_id))
    if row is None:  # _recompute always creates the row; guard for type narrowing
        raise ApiError(500, "budget_missing", "Budget row was not created")
    row.extra_allowance = _money(row.extra_allowance) + grant
    out = _recompute(session, agent)
    session.commit()
    return out


def _agents_with_versions(session: Session) -> list[Agent]:
    stmt = (
        select(Agent)
        .where(select(AgentVersion.id).where(AgentVersion.agent_id == Agent.id).exists())
        .order_by(Agent.name, Agent.slug)
    )
    return list(session.scalars(stmt))


def list_budgets(session: Session) -> list[BudgetOut]:
    out = [_recompute(session, a) for a in _agents_with_versions(session)]
    session.commit()
    return out


def admin_queue(session: Session) -> AdminQueue:
    paused = [b for b in list_budgets(session) if b.state == "paused"]
    items = [
        BudgetPauseItem(
            agent_id=b.agent_id,
            agent_name=b.agent_name,
            spent=b.spent,
            cap=b.cap,
            extra_allowance=b.extra_allowance,
            cap_total=b.cap_total,
            since=b.updated_at,
        )
        for b in sorted(paused, key=lambda b: b.updated_at)
    ]
    return AdminQueue(items=items)
