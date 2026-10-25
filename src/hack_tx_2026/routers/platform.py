"""owner:platform's endpoints: registry, connectors/grants, budgets, evals,
admin reads, tickets, identity and seeded users. Add routes here, never in app.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from hack_tx_2026 import registry
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import User
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import UserPublic
from hack_tx_2026.models.registry import (
    AgentDetail,
    AgentPage,
    CopyRequest,
    SpecYamlRequest,
    ValidateResponse,
)
from hack_tx_2026.routers.budgets import router as budgets_router

router = APIRouter(prefix="/v1", tags=["platform"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


@router.get("/users")
def list_users(session: Annotated[Session, Depends(get_session)]) -> list[UserPublic]:
    """Seeded users for the role switcher. No identity header required."""
    rows = session.query(User).order_by(User.created_at, User.id).all()
    return [UserPublic(id=u.id, name=u.name, role=u.role) for u in rows]


@router.get("/me")
def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> UserPublic:
    return UserPublic(id=user.id, name=user.name, role=user.role)


@router.post("/agents/validate")
def validate_agent_spec(body: SpecYamlRequest, user: UserDep) -> ValidateResponse:
    errors = registry.validate(body.spec_yaml)
    return ValidateResponse(valid=not errors, errors=errors)


@router.post("/agents", status_code=201)
def create_agent(body: SpecYamlRequest, session: SessionDep, user: UserDep) -> AgentDetail:
    return registry.create_agent(session, user, body.spec_yaml)


@router.get("/agents")
def list_agents(
    session: SessionDep,
    user: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> AgentPage:
    return registry.list_agents(session, limit, cursor)


@router.get("/agents/{agent_id}")
def get_agent(agent_id: str, session: SessionDep, user: UserDep) -> AgentDetail:
    return registry.get_agent_detail(session, agent_id)


@router.post("/agents/{agent_id}/versions", status_code=201)
def add_agent_version(
    agent_id: str, body: SpecYamlRequest, session: SessionDep, user: UserDep
) -> AgentDetail:
    return registry.add_version(session, user, agent_id, body.spec_yaml)


@router.post("/agents/{agent_id}/copy", status_code=201)
def copy_agent(agent_id: str, body: CopyRequest, session: SessionDep, user: UserDep) -> AgentDetail:
    return registry.copy_agent(session, user, agent_id, body.slug, body.name)


@router.post("/agents/{agent_id}/versions/{version_number}/deploy")
def deploy_agent_version(
    agent_id: str, version_number: int, session: SessionDep, user: UserDep
) -> AgentDetail:
    return registry.deploy_version(session, user, agent_id, version_number)


router.include_router(budgets_router)
