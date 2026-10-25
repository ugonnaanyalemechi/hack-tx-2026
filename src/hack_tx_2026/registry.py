"""The registry: validates specs, stores versions, tracks the live version,
enforces ownership, and (later, #27) applies the eval gate on deploy.
"""

import yaml
from pydantic import ValidationError
from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import Agent, AgentVersion
from hack_tx_2026.models.spec import AgentSpec


class RegistryError(Exception):
    def __init__(self, code: str, message: str, field: str | None = None):
        self.code = code
        self.message = message
        self.field = field
        super().__init__(message)


def parse_spec(yaml_text: str) -> AgentSpec:
    """Raises RegistryError(code="invalid_spec") naming the bad field."""
    try:
        raw = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise RegistryError("invalid_yaml", str(exc)) from exc

    if not isinstance(raw, dict):
        raise RegistryError("invalid_spec", "The spec must be a YAML mapping.")

    try:
        return AgentSpec.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"]) or None
        raise RegistryError("invalid_spec", first["msg"], field=field) from exc


def _slug_taken(session: Session, slug: str) -> bool:
    return session.query(Agent).filter_by(slug=slug).first() is not None


def create_agent(session: Session, owner_id: str, spec: AgentSpec) -> Agent:
    if _slug_taken(session, spec.slug):
        raise RegistryError("slug_taken", f"Slug {spec.slug!r} is already in use.", field="slug")

    agent = Agent(
        slug=spec.slug,
        name=spec.name,
        description=spec.description,
        owner_id=owner_id,
    )
    session.add(agent)
    session.flush()  # assigns agent.id

    version = AgentVersion(
        agent_id=agent.id,
        version_number=1,
        spec=spec.model_dump(mode="json"),
        status="draft",
    )
    session.add(version)
    session.commit()
    session.refresh(agent)
    return agent


def add_version(session: Session, agent_id: str, caller_id: str, spec: AgentSpec) -> AgentVersion:
    agent = get_agent(session, agent_id)
    if agent.owner_id != caller_id:
        raise RegistryError(
            "forbidden", "Only the agent's owner can add a version; copy it instead."
        )

    latest = (
        session.query(AgentVersion)
        .filter_by(agent_id=agent_id)
        .order_by(AgentVersion.version_number.desc())
        .first()
    )
    next_number = (latest.version_number if latest else 0) + 1

    version = AgentVersion(
        agent_id=agent_id,
        version_number=next_number,
        spec=spec.model_dump(mode="json"),
        status="draft",
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return version


def copy_agent(
    session: Session, source_agent_id: str, owner_id: str, slug: str, name: str | None = None
) -> Agent:
    """Copies the source agent's live version, falling back to its latest
    version if it has never been deployed."""
    source = get_agent(session, source_agent_id)
    version_number = (
        None if source.live_version_id else _latest_version_number(session, source_agent_id)
    )
    source_version = get_version(session, source_agent_id, version_number=version_number)
    spec = AgentSpec.model_validate(source_version.spec)
    spec = spec.model_copy(update={"slug": slug, "name": name or source.name})
    return create_agent(session, owner_id, spec)


def _latest_version_number(session: Session, agent_id: str) -> int | None:
    latest = (
        session.query(AgentVersion)
        .filter_by(agent_id=agent_id)
        .order_by(AgentVersion.version_number.desc())
        .first()
    )
    return latest.version_number if latest else None


def get_agent(session: Session, agent_id: str) -> Agent:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise RegistryError("not_found", f"No agent with id {agent_id!r}.")
    return agent


def get_version(session: Session, agent_id: str, version_number: int | None = None) -> AgentVersion:
    """Returns the live version when version_number is omitted."""
    if version_number is None:
        agent = get_agent(session, agent_id)
        if agent.live_version_id is None:
            raise RegistryError("not_found", f"Agent {agent_id!r} has no live version.")
        version = session.get(AgentVersion, agent.live_version_id)
        if version is None:
            raise RegistryError("not_found", f"Agent {agent_id!r} has no live version.")
        return version

    version = (
        session.query(AgentVersion)
        .filter_by(agent_id=agent_id, version_number=version_number)
        .first()
    )
    if version is None:
        raise RegistryError("not_found", f"Agent {agent_id!r} has no version {version_number}.")
    return version


def list_agents(session: Session) -> list[Agent]:
    return session.query(Agent).order_by(Agent.created_at).all()


def deploy_version(
    session: Session, agent_id: str, version_number: int, caller_id: str
) -> AgentVersion:
    """Deploy without the eval gate (added in #27): makes the version live unconditionally."""
    agent = get_agent(session, agent_id)
    if agent.owner_id != caller_id:
        raise RegistryError("forbidden", "Only the agent's owner can deploy a version.")

    version = get_version(session, agent_id, version_number)
    version.status = "deployed"
    agent.live_version_id = version.id
    session.add(version)
    session.add(agent)
    session.commit()
    session.refresh(version)
    return version
