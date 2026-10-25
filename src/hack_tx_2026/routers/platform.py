"""owner:platform's endpoints: registry, connectors/grants, budgets, evals,
admin reads, tickets, identity and seeded users. Add routes here, never in app.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from hack_tx_2026 import connectors, registry
from hack_tx_2026.connectors import ConnectorLayerError
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Connector, ConnectorGrant, User
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import UserPublic
from hack_tx_2026.models.connector_api import ConnectorOut, GrantOut, GrantRequest, ToolOut
from hack_tx_2026.models.evals import DeployRequest, DeployResponse
from hack_tx_2026.models.registry import (
    AgentDetail,
    AgentPage,
    CopyRequest,
    SpecYamlRequest,
    ValidateResponse,
)
from hack_tx_2026.routers.admin_reads import router as admin_reads_router
from hack_tx_2026.routers.budgets import router as budgets_router
from hack_tx_2026.routers.connectors import router as connectors_router
from hack_tx_2026.routers.evals import router as evals_router
from hack_tx_2026.routers.tickets import router as tickets_router

router = APIRouter(prefix="/v1", tags=["platform"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


def _require_admin(user: UserDep) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail={
                "error": {
                    "code": "forbidden",
                    "message": "Only an admin can grant or revoke a connector.",
                    "details": None,
                }
            },
        )
    return user


def _connector_out(connector: Connector) -> ConnectorOut:
    return ConnectorOut(
        id=connector.id,
        name=connector.name,
        description=connector.description,
        tools=[ToolOut(**tool) for tool in connector.tools],
    )


def _grant_out(grant: ConnectorGrant) -> GrantOut:
    return GrantOut(
        id=grant.id,
        connector_id=grant.connector_id,
        agent_id=grant.agent_id,
        granted_by=grant.granted_by,
        granted_at=grant.granted_at,
        revoked_at=grant.revoked_at,
    )


@router.get("/users")
def list_users(session: Annotated[Session, Depends(get_session)]) -> list[UserPublic]:
    """Seeded users for the role switcher. No identity header required."""
    rows = session.query(User).order_by(User.created_at, User.id).all()
    return [UserPublic(id=u.id, name=u.name, role=u.role) for u in rows]


@router.get("/me")
def me(user: Annotated[CurrentUser, Depends(get_current_user)]) -> UserPublic:
    return UserPublic(id=user.id, name=user.name, role=user.role)


@router.get("/connectors", response_model=list[ConnectorOut])
def list_connectors(session: SessionDep) -> list[ConnectorOut]:
    rows = session.query(Connector).order_by(Connector.name).all()
    return [_connector_out(c) for c in rows]


@router.post("/connectors/{connector_id}/grants", response_model=GrantOut, status_code=201)
def grant_connector(
    connector_id: str,
    body: GrantRequest,
    session: SessionDep,
    admin: Annotated[CurrentUser, Depends(_require_admin)],
) -> GrantOut:
    grant = connectors.grant_connector(session, connector_id, body.agent_id, admin.id)
    return _grant_out(grant)


@router.delete("/connectors/{connector_id}/grants/{agent_id}", status_code=204)
def revoke_connector(
    connector_id: str,
    agent_id: str,
    session: SessionDep,
    admin: Annotated[CurrentUser, Depends(_require_admin)],
) -> None:
    try:
        connectors.revoke_connector(session, connector_id, agent_id)
    except ConnectorLayerError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": exc.code, "message": exc.message, "details": None}},
        ) from exc


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
    return registry.get_agent_detail(session, user, agent_id)


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
    agent_id: str,
    version_number: int,
    session: SessionDep,
    user: UserDep,
    body: DeployRequest | None = None,
) -> DeployResponse:
    override_reason = body.override_reason if body else None
    return registry.deploy_version(session, user, agent_id, version_number, override_reason)


router.include_router(admin_reads_router)
router.include_router(budgets_router)
router.include_router(connectors_router)
router.include_router(evals_router)
router.include_router(tickets_router)
