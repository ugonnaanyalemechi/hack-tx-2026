"""Registry service: spec validation and agent/version storage rules."""

import base64
import re
from typing import Any

import yaml
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Agent, AgentVersion
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.registry import (
    AgentDetail,
    AgentListItem,
    AgentPage,
    AgentVersionOut,
    SpecError,
)
from hack_tx_2026.models.spec import AgentSpec

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SLUG_MESSAGE = "slug must be kebab-case: lowercase letters and digits separated by single hyphens"
CREATOR_ROLES = {"admin", "builder"}


def _slug_error(slug: str) -> list[SpecError]:
    return [] if SLUG_RE.match(slug) else [SpecError(field="slug", message=SLUG_MESSAGE)]


def parse_spec(spec_yaml: str) -> tuple[AgentSpec | None, list[SpecError]]:
    try:
        data: Any = yaml.safe_load(spec_yaml)
    except yaml.YAMLError as exc:
        return None, [SpecError(field="spec_yaml", message=f"Invalid YAML: {exc}")]
    if not isinstance(data, dict):
        return None, [SpecError(field="spec_yaml", message="Spec must be a YAML mapping of fields")]
    errors: list[SpecError] = []
    spec: AgentSpec | None = None
    try:
        spec = AgentSpec.model_validate(data)
    except ValidationError as exc:
        for e in exc.errors():
            field = ".".join(str(p) for p in e["loc"])
            if e["type"] == "none_required" and field == "trigger":
                message = "trigger is reserved and must be empty"
            else:
                message = e["msg"]
            errors.append(SpecError(field=field, message=message))
    slug = data.get("slug")
    if isinstance(slug, str) and not any(e.field == "slug" for e in errors):
        errors.extend(_slug_error(slug))
    if errors:
        return None, errors
    return spec, []


def _invalid(errors: list[SpecError]) -> ApiError:
    return ApiError(
        422,
        "invalid_spec",
        "Spec is invalid",
        {"errors": [e.model_dump() for e in errors]},
    )


def _valid_spec(spec_yaml: str) -> AgentSpec:
    spec, errors = parse_spec(spec_yaml)
    if spec is None:
        raise _invalid(errors)
    return spec


def require_creator(user: CurrentUser) -> None:
    if user.role not in CREATOR_ROLES:
        raise ApiError(403, "forbidden", "Only admins and builders can do this")


def _get_agent(session: Session, agent_id: str) -> Agent:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    return agent


def _require_owner(agent: Agent, user: CurrentUser, action: str) -> None:
    if agent.owner_id != user.id:
        raise ApiError(
            403,
            "not_owner",
            f"Only the owner can {action}. Copy the agent to make your own version.",
        )


def _versions(session: Session, agent_id: str) -> list[AgentVersion]:
    stmt = (
        select(AgentVersion)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(AgentVersion.version_number)
    )
    return list(session.scalars(stmt))


def _live_number(agent: Agent, versions: list[AgentVersion]) -> int | None:
    for v in versions:
        if v.id == agent.live_version_id:
            return v.version_number
    return None


def _list_item(agent: Agent, versions: list[AgentVersion]) -> AgentListItem:
    return AgentListItem(
        id=agent.id,
        slug=agent.slug,
        name=agent.name,
        description=agent.description,
        owner_id=agent.owner_id,
        live_version_number=_live_number(agent, versions),
        latest_version_number=versions[-1].version_number if versions else None,
    )


def _detail(session: Session, agent: Agent) -> AgentDetail:
    versions = _versions(session, agent.id)
    return AgentDetail(
        **_list_item(agent, versions).model_dump(),
        versions=[
            AgentVersionOut(
                version_number=v.version_number,
                status=v.status,
                created_at=v.created_at,
                spec=v.spec,
            )
            for v in versions
        ],
    )


def _insert_agent(
    session: Session, owner_id: str, spec: AgentSpec, spec_json: dict[str, Any]
) -> Agent:
    agent = Agent(slug=spec.slug, name=spec.name, description=spec.description, owner_id=owner_id)
    session.add(agent)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise ApiError(409, "slug_taken", f"Slug '{spec.slug}' is already taken") from None
    session.add(AgentVersion(agent_id=agent.id, version_number=1, spec=spec_json, status="draft"))
    session.commit()
    return agent


def _slug_taken(session: Session, slug: str) -> bool:
    return session.scalar(select(Agent.id).where(Agent.slug == slug)) is not None


def validate(spec_yaml: str) -> list[SpecError]:
    return parse_spec(spec_yaml)[1]


def create_agent(session: Session, user: CurrentUser, spec_yaml: str) -> AgentDetail:
    require_creator(user)
    spec = _valid_spec(spec_yaml)
    agent = _insert_agent(session, user.id, spec, spec.model_dump(mode="json"))
    return _detail(session, agent)


def add_version(session: Session, user: CurrentUser, agent_id: str, spec_yaml: str) -> AgentDetail:
    agent = _get_agent(session, agent_id)
    _require_owner(agent, user, "add versions")
    spec = _valid_spec(spec_yaml)
    if spec.slug != agent.slug:
        raise _invalid(
            [SpecError(field="slug", message=f"slug must stay '{agent.slug}' for this agent")]
        )
    versions = _versions(session, agent.id)
    next_number = (versions[-1].version_number if versions else 0) + 1
    session.add(
        AgentVersion(
            agent_id=agent.id,
            version_number=next_number,
            spec=spec.model_dump(mode="json"),
            status="draft",
        )
    )
    session.commit()
    return _detail(session, agent)


def copy_agent(
    session: Session, user: CurrentUser, agent_id: str, slug: str, name: str | None
) -> AgentDetail:
    require_creator(user)
    source = _get_agent(session, agent_id)
    slug_errors = _slug_error(slug)
    if slug_errors:
        raise _invalid(slug_errors)
    if _slug_taken(session, slug):
        raise ApiError(409, "slug_taken", f"Slug '{slug}' is already taken")
    versions = _versions(session, source.id)
    chosen = next((v for v in versions if v.id == source.live_version_id), None)
    if chosen is None:
        if not versions:
            raise ApiError(404, "version_not_found", "Agent has no versions to copy")
        chosen = versions[-1]
    spec_json = {**chosen.spec, "slug": slug}
    if name:
        spec_json["name"] = name
    spec = AgentSpec.model_validate(spec_json)
    agent = _insert_agent(session, user.id, spec, spec.model_dump(mode="json"))
    return _detail(session, agent)


def deploy_version(
    session: Session, user: CurrentUser, agent_id: str, version_number: int
) -> AgentDetail:
    agent = _get_agent(session, agent_id)
    _require_owner(agent, user, "deploy")
    version = session.scalar(
        select(AgentVersion).where(
            AgentVersion.agent_id == agent.id, AgentVersion.version_number == version_number
        )
    )
    if version is None:
        raise ApiError(404, "version_not_found", "Version not found")
    version.status = "deployed"
    agent.live_version_id = version.id
    session.commit()
    return _detail(session, agent)


def get_agent_detail(session: Session, agent_id: str) -> AgentDetail:
    return _detail(session, _get_agent(session, agent_id))


def _encode_cursor(slug: str) -> str:
    return base64.urlsafe_b64encode(slug.encode()).decode()


def _decode_cursor(cursor: str) -> str:
    try:
        return base64.urlsafe_b64decode(cursor.encode()).decode()
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


def list_agents(session: Session, limit: int, cursor: str | None) -> AgentPage:
    stmt = select(Agent).order_by(Agent.slug).limit(limit + 1)
    if cursor:
        stmt = stmt.where(Agent.slug > _decode_cursor(cursor))
    rows = list(session.scalars(stmt))
    page_rows = rows[:limit]
    items = [_list_item(a, _versions(session, a.id)) for a in page_rows]
    next_cursor = _encode_cursor(page_rows[-1].slug) if len(rows) > limit else None
    return AgentPage(items=items, next_cursor=next_cursor)
