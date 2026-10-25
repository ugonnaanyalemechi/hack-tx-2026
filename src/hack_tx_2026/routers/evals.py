"""Eval case and eval report endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from hack_tx_2026 import eval_cases, eval_runner
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Agent
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.evals import EvalCaseCreate, EvalCaseList, EvalCaseOut, EvalReportOut

# Included under the platform router, which supplies the /v1 prefix.
router = APIRouter(tags=["evals"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


def _require_owner_or_admin(session: Session, agent_id: str, user: CurrentUser) -> None:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    if user.role != "admin" and agent.owner_id != user.id:
        raise ApiError(403, "forbidden", "Only the owner or an admin can do this")


@router.post("/agents/{agent_id}/eval-cases", status_code=201)
def create_eval_case(
    agent_id: str, body: EvalCaseCreate, session: SessionDep, user: UserDep
) -> EvalCaseOut:
    _require_owner_or_admin(session, agent_id, user)
    case = eval_cases.create_eval_case(
        session,
        agent_id=agent_id,
        question=body.question,
        expected_strings=body.expected_strings,
        citation_required=body.citation_required,
        rubric=body.rubric,
    )
    session.commit()
    return EvalCaseOut.model_validate(case, from_attributes=True)


@router.get("/agents/{agent_id}/eval-cases")
def list_eval_cases(agent_id: str, session: SessionDep, user: UserDep) -> EvalCaseList:
    _require_owner_or_admin(session, agent_id, user)
    cases = eval_cases.list_eval_cases(session, agent_id)
    return EvalCaseList(items=[EvalCaseOut.model_validate(c, from_attributes=True) for c in cases])


@router.get("/agents/{agent_id}/eval-report")
def read_eval_report(agent_id: str, session: SessionDep, user: UserDep) -> EvalReportOut:
    _require_owner_or_admin(session, agent_id, user)
    report = eval_runner.latest_report(session, agent_id)
    if report is None:
        raise ApiError(404, "eval_report_not_found", "No eval report for this agent yet")
    return eval_runner.report_out(session, report)
