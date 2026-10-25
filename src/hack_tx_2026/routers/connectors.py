"""Connector endpoints: list connectors, grant and revoke them per agent."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from hack_tx_2026 import connectors
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import ConnectorGrant
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.connector_api import ConnectorOut, GrantOut, GrantRequest

# Included under the platform router, which supplies the /v1 prefix.
router = APIRouter(tags=["connectors"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


def _require_admin(user: CurrentUser) -> None:
    if user.role != "admin":
        raise ApiError(403, "forbidden", "Only admins can manage connector grants")


def _grant_out(grant: ConnectorGrant) -> GrantOut:
    return GrantOut(
        id=grant.id,
        connector_id=grant.connector_id,
        agent_id=grant.agent_id,
        granted_by=grant.granted_by,
        granted_at=grant.granted_at,
        revoked_at=grant.revoked_at,
    )


@router.get("/connectors")
def list_connectors(
    db: SessionDep,
    user: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[ConnectorOut]:
    return connectors.list_connectors(db, limit, cursor)


@router.get("/connectors/grants")
def list_grants(
    db: SessionDep,
    user: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[GrantOut]:
    _require_admin(user)
    return connectors.list_active_grants(db, limit, cursor)


@router.post("/connectors/{connector_id}/grants", response_model=GrantOut, status_code=201)
def grant_connector(
    connector_id: str,
    body: GrantRequest,
    db: SessionDep,
    user: UserDep,
) -> GrantOut:
    _require_admin(user)
    grant = connectors.grant_connector(db, connector_id, body.agent_id, user.id)
    db.commit()
    return _grant_out(grant)


@router.delete("/connectors/{connector_id}/grants/{agent_id}", status_code=204)
def revoke_connector(
    connector_id: str,
    agent_id: str,
    db: SessionDep,
    user: UserDep,
) -> None:
    _require_admin(user)
    connectors.revoke_connector(db, connector_id, agent_id)
    db.commit()
