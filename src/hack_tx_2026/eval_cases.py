"""Eval case service. Functions flush; callers commit.

`create_eval_case` is also called by the flag flow (ticket #29) with origin="flag".
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Agent, EvalCase
from hack_tx_2026.errors import ApiError


def create_eval_case(
    session: Session,
    *,
    agent_id: str,
    question: str,
    expected_strings: Iterable[str] = (),
    citation_required: bool = False,
    rubric: str | None = None,
    origin: str = "manual",
) -> EvalCase:
    if session.get(Agent, agent_id) is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    question = question.strip()
    expected = [s.strip() for s in expected_strings if s.strip()]
    rubric = (rubric or "").strip() or None
    if not question or not (expected or citation_required or rubric):
        raise ApiError(
            422,
            "empty_eval_case",
            "An eval case needs a question and at least one check "
            "(expected strings, citation required or a rubric)",
        )
    case = EvalCase(
        agent_id=agent_id,
        question=question,
        expected_strings=expected,
        citation_required=citation_required,
        rubric=rubric,
        origin=origin,
    )
    session.add(case)
    session.flush()
    return case


def list_eval_cases(session: Session, agent_id: str) -> list[EvalCase]:
    stmt = (
        select(EvalCase)
        .where(EvalCase.agent_id == agent_id)
        .order_by(EvalCase.created_at, EvalCase.id)
    )
    return list(session.scalars(stmt))
