"""The connector layer: loads MCP tools for an agent, limited to connectors
an admin has granted and to the agent's allow-list. Marks side-effect
tools so the runtime asks for approval before running them.
"""

import datetime as dt
from dataclasses import dataclass

from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import AgentVersion, Connector, ConnectorGrant
from hack_tx_2026.fake_mcp import CONNECTOR_NAME, TOOL_DEFS
from hack_tx_2026.models.spec import AgentSpec


class ConnectorLayerError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class LoadedTool:
    connector_name: str
    name: str
    side_effect: bool


def seed_fake_mcp_connector(session: Session) -> Connector:
    """Idempotent: creates the fake-mcp connector row if it's missing."""
    connector = session.query(Connector).filter_by(name=CONNECTOR_NAME).first()
    if connector is None:
        connector = Connector(
            name=CONNECTOR_NAME,
            description="Fake MCP server: a read-only lookup tool and a side-effect note tool.",
            tools=TOOL_DEFS,
        )
        session.add(connector)
        session.commit()
        session.refresh(connector)
    return connector


def is_granted(session: Session, connector_id: str, agent_id: str) -> bool:
    grant = (
        session.query(ConnectorGrant)
        .filter_by(connector_id=connector_id, agent_id=agent_id, revoked_at=None)
        .first()
    )
    return grant is not None


def grant_connector(
    session: Session, connector_id: str, agent_id: str, granted_by: str
) -> ConnectorGrant:
    """Idempotent: returns the existing active grant if there is one."""
    existing = (
        session.query(ConnectorGrant)
        .filter_by(connector_id=connector_id, agent_id=agent_id, revoked_at=None)
        .first()
    )
    if existing is not None:
        return existing

    grant = ConnectorGrant(connector_id=connector_id, agent_id=agent_id, granted_by=granted_by)
    session.add(grant)
    session.commit()
    session.refresh(grant)
    return grant


def revoke_connector(session: Session, connector_id: str, agent_id: str) -> None:
    grant = (
        session.query(ConnectorGrant)
        .filter_by(connector_id=connector_id, agent_id=agent_id, revoked_at=None)
        .first()
    )
    if grant is None:
        raise ConnectorLayerError("not_found", "No active grant for this connector and agent.")
    grant.revoked_at = dt.datetime.now(dt.UTC)
    session.add(grant)
    session.commit()


def load_agent_tools(session: Session, agent_version_id: str) -> list[LoadedTool]:
    """An ungranted connector's tools are never loaded. A tool is a side
    effect if either the connector says so or the builder's spec marks it —
    whichever is more cautious wins.
    """
    version = session.get(AgentVersion, agent_version_id)
    if version is None:
        raise ConnectorLayerError("not_found", f"No agent version {agent_version_id!r}.")
    spec = AgentSpec.model_validate(version.spec)

    tools: list[LoadedTool] = []
    for connector_spec in spec.connectors:
        connector = session.query(Connector).filter_by(name=connector_spec.name).first()
        if connector is None or not is_granted(session, connector.id, version.agent_id):
            continue

        for tool_def in connector.tools:
            name = tool_def["name"]
            if connector_spec.allow_list is not None and name not in connector_spec.allow_list:
                continue
            side_effect = (
                bool(tool_def.get("side_effect")) or name in connector_spec.side_effect_tools
            )
            tools.append(
                LoadedTool(connector_name=connector.name, name=name, side_effect=side_effect)
            )

    return tools
