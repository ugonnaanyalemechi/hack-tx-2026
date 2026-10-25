"""owner:platform's endpoints: registry, connectors/grants, budgets, evals,
admin reads, tickets, identity and seeded users. Empty until its ticket
lands — add routes here, never in app.py.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from hack_tx_2026 import connectors
from hack_tx_2026.connectors import ConnectorLayerError
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Connector, ConnectorGrant, User
from hack_tx_2026.models.connector_api import ConnectorOut, GrantOut, GrantRequest, ToolOut
from hack_tx_2026.settings import get_settings

router = APIRouter(prefix="/v1", tags=["platform"])


# Ticket #13 (identity.py, seeded users) is in flight separately and isn't
# on main yet. This is a minimal, self-contained stand-in for the
# admin-only connector endpoints below — replace with the real
# hack_tx_2026.identity.current_user once #13 merges.
def _require_admin(request: Request, db: Session = Depends(get_session)) -> User:
    header_name = get_settings().identity_header_name
    user_id = request.headers.get(header_name)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "missing_identity_header",
                    "message": f"The {header_name} header is required.",
                    "details": None,
                }
            },
        )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "unknown_user",
                    "message": f"No user with id {user_id!r}.",
                    "details": None,
                }
            },
        )
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


@router.get("/connectors", response_model=list[ConnectorOut])
def list_connectors(db: Session = Depends(get_session)) -> list[ConnectorOut]:
    rows = db.query(Connector).order_by(Connector.name).all()
    return [_connector_out(c) for c in rows]


@router.post("/connectors/{connector_id}/grants", response_model=GrantOut, status_code=201)
def grant_connector(
    connector_id: str,
    body: GrantRequest,
    db: Session = Depends(get_session),
    admin: User = Depends(_require_admin),
) -> GrantOut:
    grant = connectors.grant_connector(db, connector_id, body.agent_id, admin.id)
    return _grant_out(grant)


@router.delete("/connectors/{connector_id}/grants/{agent_id}", status_code=204)
def revoke_connector(
    connector_id: str,
    agent_id: str,
    db: Session = Depends(get_session),
    admin: User = Depends(_require_admin),
) -> None:
    try:
        connectors.revoke_connector(db, connector_id, agent_id)
    except ConnectorLayerError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": exc.code, "message": exc.message, "details": None}},
        ) from exc
