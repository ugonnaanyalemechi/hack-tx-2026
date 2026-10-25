"""Ticket service (flagged answers). Functions flush; callers commit."""

import datetime as dt
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from hack_tx_2026 import eval_cases
from hack_tx_2026.admin_reads import (
    _b64,
    _db_dt,
    _decode_run_cursor,
    _scope_agent_ids,
    _utc,
)
from hack_tx_2026.db.orm import Agent, EvalCase, Run, Ticket, User
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.budgets import OpenTicketItem
from hack_tx_2026.models.tickets import SaveAsTestCaseRequest, TicketDetail, TicketListItem

SNIPPET_LENGTH = 120


def create_ticket(
    session: Session, *, run_id: str, question: str, answer: str, created_by: str
) -> Ticket:
    if session.get(Run, run_id) is None:
        raise LookupError(f"run {run_id} not found")
    ticket = Ticket(run_id=run_id, question=question, answer=answer, created_by=created_by)
    session.add(ticket)
    session.flush()
    return ticket


def attach_recheck_run(session: Session, *, ticket_id: str, recheck_run_id: str) -> Ticket:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise LookupError(f"ticket {ticket_id} not found")
    if session.get(Run, recheck_run_id) is None:
        raise LookupError(f"run {recheck_run_id} not found")
    ticket.recheck_run_id = recheck_run_id
    session.flush()
    return ticket


def _item_fields(ticket: Ticket, agent: Agent) -> dict:
    return {
        "id": ticket.id,
        "agent_id": agent.id,
        "agent_name": agent.name,
        "run_id": ticket.run_id,
        "recheck_run_id": ticket.recheck_run_id,
        "question": ticket.question,
        "status": ticket.status,
        "created_by": ticket.created_by,
        "created_at": _utc(ticket.created_at),
        "resolved_at": _utc(ticket.resolved_at) if ticket.resolved_at else None,
    }


def _load_authorized(session: Session, user: CurrentUser, ticket_id: str) -> tuple[Ticket, Agent]:
    ticket = session.get(Ticket, ticket_id)
    if ticket is None:
        raise ApiError(404, "ticket_not_found", "Ticket not found")
    run = session.get(Run, ticket.run_id)
    agent = session.get(Agent, run.agent_id) if run else None
    if agent is None:  # pragma: no cover — FK guarantees this
        raise ApiError(404, "ticket_not_found", "Ticket not found")
    if user.role != "admin" and agent.owner_id != user.id:
        raise ApiError(403, "forbidden", "Only the owner or an admin can see this ticket")
    return ticket, agent


def _detail(session: Session, ticket: Ticket, agent: Agent) -> TicketDetail:
    creator = session.get(User, ticket.created_by)
    return TicketDetail(
        **_item_fields(ticket, agent),
        answer=ticket.answer,
        note=ticket.note,
        created_by_name=creator.name if creator else None,
    )


def get_ticket(session: Session, user: CurrentUser, ticket_id: str) -> TicketDetail:
    ticket, agent = _load_authorized(session, user, ticket_id)
    return _detail(session, ticket, agent)


def list_tickets(
    session: Session,
    user: CurrentUser,
    agent_id: str | None,
    status: Literal["open", "resolved"] | None,
    limit: int,
    cursor: str | None,
) -> Page[TicketListItem]:
    try:
        scope = _scope_agent_ids(session, user, agent_id)
    except ApiError as exc:
        if exc.status_code != 403:
            raise
        raise ApiError(
            403, "forbidden", "Only the owner or an admin can see these tickets"
        ) from None
    stmt = (
        select(Ticket, Agent)
        .join(Run, Run.id == Ticket.run_id)
        .join(Agent, Agent.id == Run.agent_id)
        .order_by(Ticket.created_at.desc(), Ticket.id.desc())
        .limit(limit + 1)
    )
    if scope is not None:
        stmt = stmt.where(Agent.id.in_(scope))
    if status is not None:
        stmt = stmt.where(Ticket.status == status)
    if cursor:
        stamp, ticket_id = _decode_run_cursor(cursor)
        stamp_db = _db_dt(stamp)
        stmt = stmt.where(
            or_(
                Ticket.created_at < stamp_db,
                and_(Ticket.created_at == stamp_db, Ticket.id < ticket_id),
            )
        )
    rows = list(session.execute(stmt).all())
    page_rows = rows[:limit]
    items = [TicketListItem(**_item_fields(t, a)) for t, a in page_rows]
    next_cursor = None
    if len(rows) > limit:
        last = page_rows[-1][0]
        next_cursor = _b64(f"{_utc(last.created_at).isoformat()}|{last.id}")
    return Page[TicketListItem](items=items, next_cursor=next_cursor)


def resolve_ticket(session: Session, user: CurrentUser, ticket_id: str) -> TicketDetail:
    ticket, agent = _load_authorized(session, user, ticket_id)
    if ticket.status != "resolved":
        ticket.status = "resolved"
        ticket.resolved_at = dt.datetime.now(dt.UTC)
        session.flush()
    return _detail(session, ticket, agent)


def save_as_test_case(
    session: Session, user: CurrentUser, ticket_id: str, body: SaveAsTestCaseRequest
) -> EvalCase:
    ticket, agent = _load_authorized(session, user, ticket_id)
    return eval_cases.create_eval_case(
        session,
        agent_id=agent.id,
        question=ticket.question,
        expected_strings=body.expected_strings,
        citation_required=body.citation_required,
        rubric=body.rubric,
        origin="flag",
    )


def _snippet(text: str) -> str:
    if len(text) <= SNIPPET_LENGTH:
        return text
    return text[:SNIPPET_LENGTH] + "…"


def open_ticket_items(session: Session) -> list[OpenTicketItem]:
    stmt = (
        select(Ticket, Agent)
        .join(Run, Run.id == Ticket.run_id)
        .join(Agent, Agent.id == Run.agent_id)
        .where(Ticket.status == "open")
        .order_by(Ticket.created_at, Ticket.id)
    )
    return [
        OpenTicketItem(
            ticket_id=t.id,
            agent_id=a.id,
            agent_name=a.name,
            question=_snippet(t.question),
            since=_utc(t.created_at),
        )
        for t, a in session.execute(stmt).all()
    ]
