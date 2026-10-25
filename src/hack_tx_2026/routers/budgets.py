"""Budget endpoints: per-agent budget, admin approval, budget list and queue."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from hack_tx_2026 import budgets, eval_runner
from hack_tx_2026.db.base import get_session
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.budgets import AdminQueue, ApproveSpendRequest, BudgetList, BudgetOut

# Included under the platform router, which supplies the /v1 prefix.
router = APIRouter(tags=["budgets"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


def _require_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise ApiError(403, "forbidden", "Only admins can do this")


@router.get("/agents/{agent_id}/budget")
def read_budget(agent_id: str, session: SessionDep, user: UserDep) -> BudgetOut:
    if user.role != "admin" and budgets.owner_id(session, agent_id) != user.id:
        raise ApiError(403, "forbidden", "Only the owner or an admin can see this budget")
    return budgets.get_budget(session, agent_id)


@router.post("/agents/{agent_id}/budget/approve")
def approve_spend(
    agent_id: str,
    session: SessionDep,
    user: UserDep,
    body: ApproveSpendRequest | None = None,
) -> BudgetOut:
    _require_admin(user)
    amount = body.amount if body else None
    return budgets.approve_extra_spend(session, agent_id, amount)


@router.get("/admin/budgets")
def list_budgets(session: SessionDep, user: UserDep) -> BudgetList:
    _require_admin(user)
    return BudgetList(items=budgets.list_budgets(session))


@router.get("/admin/queue")
def admin_queue(session: SessionDep, user: UserDep) -> AdminQueue:
    _require_admin(user)
    queue = budgets.admin_queue(session)
    items = [*queue.items, *eval_runner.blocked_deploy_items(session)]
    return AdminQueue(items=sorted(items, key=lambda i: i.since))
