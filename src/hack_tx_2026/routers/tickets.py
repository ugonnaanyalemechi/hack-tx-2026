"""Ticket endpoints: list, read, resolve and save as a test case."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from hack_tx_2026 import tickets
from hack_tx_2026.db.base import get_session
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.evals import EvalCaseOut
from hack_tx_2026.models.tickets import SaveAsTestCaseRequest, TicketDetail, TicketListItem

# Included under the platform router, which supplies the /v1 prefix.
router = APIRouter(tags=["tickets"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


@router.get("/tickets")
def list_tickets(
    session: SessionDep,
    user: UserDep,
    agent_id: str | None = None,
    status: Literal["open", "resolved"] | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[TicketListItem]:
    return tickets.list_tickets(session, user, agent_id, status, limit, cursor)


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, session: SessionDep, user: UserDep) -> TicketDetail:
    return tickets.get_ticket(session, user, ticket_id)


@router.post("/tickets/{ticket_id}/resolve")
def resolve_ticket(ticket_id: str, session: SessionDep, user: UserDep) -> TicketDetail:
    detail = tickets.resolve_ticket(session, user, ticket_id)
    session.commit()
    return detail


@router.post("/tickets/{ticket_id}/save-as-test-case", status_code=201)
def save_as_test_case(
    ticket_id: str, body: SaveAsTestCaseRequest, session: SessionDep, user: UserDep
) -> EvalCaseOut:
    case = tickets.save_as_test_case(session, user, ticket_id, body)
    session.commit()
    return EvalCaseOut.model_validate(case, from_attributes=True)
