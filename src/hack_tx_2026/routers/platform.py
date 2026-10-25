"""owner:platform's endpoints: registry, connectors/grants, budgets, evals,
admin reads, tickets, identity and seeded users.
"""

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hack_tx_2026 import registry
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Agent, AgentVersion, User
from hack_tx_2026.identity import current_user
from hack_tx_2026.models.agent_api import (
    AddVersionRequest,
    AgentDetailOut,
    AgentOut,
    AgentVersionOut,
    CopyAgentRequest,
    CreateAgentRequest,
    UserOut,
    ValidateError,
    ValidateRequest,
    ValidateResponse,
)
from hack_tx_2026.registry import RegistryError

router = APIRouter(prefix="/v1", tags=["platform"])

_ERROR_STATUS = {
    "not_found": 404,
    "forbidden": 403,
}


def _raise(error: RegistryError) -> NoReturn:
    status_code = _ERROR_STATUS.get(error.code, 400)
    raise HTTPException(
        status_code=status_code,
        detail={
            "error": {
                "code": error.code,
                "message": error.message,
                "details": {"field": error.field} if error.field else None,
            }
        },
    )


def _agent_out(agent: Agent) -> AgentOut:
    return AgentOut(
        id=agent.id,
        slug=agent.slug,
        name=agent.name,
        description=agent.description,
        owner_id=agent.owner_id,
        live_version_id=agent.live_version_id,
        created_at=agent.created_at,
    )


def _version_out(version: AgentVersion) -> AgentVersionOut:
    return AgentVersionOut(
        id=version.id,
        version_number=version.version_number,
        status=version.status,
        created_at=version.created_at,
    )


@router.get("/users", response_model=list[UserOut])
def list_seeded_users(db: Session = Depends(get_session)) -> list[User]:
    return db.query(User).order_by(User.role, User.name).all()


@router.post("/agents/validate", response_model=ValidateResponse)
def validate_agent_spec(body: ValidateRequest) -> ValidateResponse:
    try:
        registry.parse_spec(body.yaml)
    except RegistryError as exc:
        return ValidateResponse(
            valid=False,
            errors=[ValidateError(code=exc.code, message=exc.message, field=exc.field)],
        )
    return ValidateResponse(valid=True)


@router.get("/agents", response_model=list[AgentOut])
def list_agents(db: Session = Depends(get_session)) -> list[AgentOut]:
    return [_agent_out(a) for a in registry.list_agents(db)]


@router.get("/agents/{agent_id}", response_model=AgentDetailOut)
def read_agent(agent_id: str, db: Session = Depends(get_session)) -> AgentDetailOut:
    try:
        agent = registry.get_agent(db, agent_id)
    except RegistryError as exc:
        _raise(exc)
    versions = (
        db.query(AgentVersion)
        .filter_by(agent_id=agent_id)
        .order_by(AgentVersion.version_number)
        .all()
    )
    return AgentDetailOut(
        **_agent_out(agent).model_dump(), versions=[_version_out(v) for v in versions]
    )


@router.post("/agents", response_model=AgentOut, status_code=201)
def create_agent(
    body: CreateAgentRequest,
    db: Session = Depends(get_session),
    user: User = Depends(current_user),
) -> AgentOut:
    try:
        spec = registry.parse_spec(body.yaml)
        agent = registry.create_agent(db, user.id, spec)
    except RegistryError as exc:
        _raise(exc)
    return _agent_out(agent)


@router.post("/agents/{agent_id}/versions", response_model=AgentVersionOut, status_code=201)
def add_agent_version(
    agent_id: str,
    body: AddVersionRequest,
    db: Session = Depends(get_session),
    user: User = Depends(current_user),
) -> AgentVersionOut:
    try:
        spec = registry.parse_spec(body.yaml)
        version = registry.add_version(db, agent_id, user.id, spec)
    except RegistryError as exc:
        _raise(exc)
    return _version_out(version)


@router.post("/agents/{agent_id}/copy", response_model=AgentOut, status_code=201)
def copy_agent(
    agent_id: str,
    body: CopyAgentRequest,
    db: Session = Depends(get_session),
    user: User = Depends(current_user),
) -> AgentOut:
    try:
        agent = registry.copy_agent(db, agent_id, user.id, body.slug, body.name)
    except RegistryError as exc:
        _raise(exc)
    return _agent_out(agent)


@router.post("/agents/{agent_id}/versions/{version_number}/deploy", response_model=AgentVersionOut)
def deploy_agent_version(
    agent_id: str,
    version_number: int,
    db: Session = Depends(get_session),
    user: User = Depends(current_user),
) -> AgentVersionOut:
    try:
        version = registry.deploy_version(db, agent_id, version_number, user.id)
    except RegistryError as exc:
        _raise(exc)
    return _version_out(version)
