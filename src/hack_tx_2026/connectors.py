"""The connector layer: loads MCP tools for an agent, limited to connectors
an admin has granted and to the agent's allow-list. Marks side-effect
tools so the runtime asks for approval before running them.

Grant and revoke flush; callers commit.
"""

import datetime as dt
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from hack_tx_2026 import fake_mcp
from hack_tx_2026.cursors import b64, unb64
from hack_tx_2026.db.orm import Agent, AgentVersion, Connector, ConnectorGrant
from hack_tx_2026.demo import filings
from hack_tx_2026.errors import ApiError
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.connector_api import ConnectorOut, GrantOut, ToolOut
from hack_tx_2026.models.spec import AgentSpec

# The MCP servers the layer can reach, by connector name. A granted
# connector with no server here has nothing to run its tools, so its tools
# are not loaded.
_SERVERS: dict[str, Callable[..., dict[str, Any]]] = {
    fake_mcp.CONNECTOR_NAME: fake_mcp.call_tool,
    filings.CONNECTOR_NAME: filings.call_tool,
}


# Each server's own tool definitions (description, input JSON Schema). Read
# at load time rather than from the connector row, so rows seeded before
# these fields existed still load complete tools.
_SERVER_DEFS: dict[str, list[dict[str, Any]]] = {
    fake_mcp.CONNECTOR_NAME: fake_mcp.TOOL_DEFS,
    filings.CONNECTOR_NAME: filings.TOOL_DEFS,
}


def _server_def(connector_name: str, tool_name: str) -> dict[str, Any]:
    """A tool's description and input schema from its server's definitions,
    with defaults for a tool (or connector) the servers don't define."""
    server_def = next(
        (d for d in _SERVER_DEFS.get(connector_name, []) if d["name"] == tool_name), {}
    )
    return {
        "description": server_def.get("description", ""),
        "input_schema": server_def.get("input_schema", {"type": "object"}),
    }


class ToolNotLoadedError(PermissionError):
    """The tool is not loaded for the agent version: its connector is not
    granted (or the grant was revoked), the allow-list excludes it, or it
    does not exist."""


@dataclass
class LoadedTool:
    connector_name: str
    name: str
    side_effect: bool
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=lambda: {"type": "object"})

    def call(self, **arguments: Any) -> dict[str, Any]:
        """Runs the tool on its connector's server, under the connector's own
        account. Takes only the tool's arguments, never the caller's identity.
        """
        return _SERVERS[self.connector_name](self.name, **arguments)


def _seed_connector(
    session: Session, name: str, description: str, tools: list[dict[str, Any]]
) -> Connector:
    """Idempotent: creates the named connector row if it's missing."""
    connector = session.query(Connector).filter_by(name=name).first()
    if connector is None:
        connector = Connector(name=name, description=description, tools=tools)
        session.add(connector)
        session.commit()
        session.refresh(connector)
    return connector


def seed_fake_mcp_connector(session: Session) -> Connector:
    """Idempotent: creates the fake-mcp connector row if it's missing."""
    return _seed_connector(
        session,
        fake_mcp.CONNECTOR_NAME,
        "Fake MCP server: a read-only lookup tool and a side-effect note tool.",
        fake_mcp.TOOL_DEFS,
    )


def seed_filings_demo_connector(session: Session) -> Connector:
    """Idempotent: creates the filings-demo connector row if it's missing.
    The only place that row is created, so the demo seed never adds a second.
    """
    return _seed_connector(
        session, filings.CONNECTOR_NAME, filings.CONNECTOR_DESCRIPTION, filings.TOOL_DEFS
    )


def list_connectors(session: Session, limit: int, cursor: str | None) -> Page[ConnectorOut]:
    """Connectors ordered by name, paged with a name cursor."""
    stmt = select(Connector).order_by(Connector.name).limit(limit + 1)
    if cursor:
        stmt = stmt.where(Connector.name > unb64(cursor))
    rows = list(session.scalars(stmt))
    page = rows[:limit]
    items = [
        ConnectorOut(
            id=c.id,
            name=c.name,
            description=c.description,
            tools=[
                ToolOut(
                    name=tool["name"],
                    side_effect=tool["side_effect"],
                    **_server_def(c.name, tool["name"]),
                )
                for tool in c.tools
            ],
        )
        for c in page
    ]
    next_cursor = b64(page[-1].name) if len(rows) > limit else None
    return Page[ConnectorOut](items=items, next_cursor=next_cursor)


def list_active_grants(session: Session, limit: int, cursor: str | None) -> Page[GrantOut]:
    """Grants not yet revoked, ordered by id, paged with an id cursor."""
    stmt = (
        select(ConnectorGrant)
        .where(ConnectorGrant.revoked_at.is_(None))
        .order_by(ConnectorGrant.id)
        .limit(limit + 1)
    )
    if cursor:
        stmt = stmt.where(ConnectorGrant.id > unb64(cursor))
    rows = list(session.scalars(stmt))
    page = rows[:limit]
    items = [GrantOut.model_validate(g, from_attributes=True) for g in page]
    next_cursor = b64(page[-1].id) if len(rows) > limit else None
    return Page[GrantOut](items=items, next_cursor=next_cursor)


def _active_grant(session: Session, connector_id: str, agent_id: str) -> ConnectorGrant | None:
    return (
        session.query(ConnectorGrant)
        .filter_by(connector_id=connector_id, agent_id=agent_id, revoked_at=None)
        .first()
    )


def is_granted(session: Session, connector_id: str, agent_id: str) -> bool:
    return _active_grant(session, connector_id, agent_id) is not None


def grant_connector(
    session: Session, connector_id: str, agent_id: str, granted_by: str
) -> ConnectorGrant:
    """Idempotent: returns the existing active grant if there is one."""
    if session.get(Connector, connector_id) is None:
        raise ApiError(404, "connector_not_found", "Connector not found")
    if session.get(Agent, agent_id) is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    existing = _active_grant(session, connector_id, agent_id)
    if existing is not None:
        return existing

    grant = ConnectorGrant(connector_id=connector_id, agent_id=agent_id, granted_by=granted_by)
    session.add(grant)
    session.flush()
    return grant


def revoke_connector(session: Session, connector_id: str, agent_id: str) -> None:
    grant = _active_grant(session, connector_id, agent_id)
    if grant is None:
        raise ApiError(404, "grant_not_found", "No active grant for this connector and agent")
    grant.revoked_at = dt.datetime.now(dt.UTC)
    session.flush()


def load_agent_tools(session: Session, agent_version_id: str) -> list[LoadedTool]:
    """An ungranted connector's tools are never loaded, nor are those of a
    connector with no server to run them. A tool is a side effect if either
    the connector says so or the builder's spec marks it — whichever is more
    cautious wins. Raises LookupError if the version is unknown.
    """
    version = session.get(AgentVersion, agent_version_id)
    if version is None:
        raise LookupError(f"agent version {agent_version_id} not found")
    spec = AgentSpec.model_validate(version.spec)

    tools: list[LoadedTool] = []
    for connector_spec in spec.connectors:
        if connector_spec.name not in _SERVERS:
            continue
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
                LoadedTool(
                    connector_name=connector.name,
                    name=name,
                    side_effect=side_effect,
                    **_server_def(connector.name, name),
                )
            )

    return tools


def call_agent_tool(
    session: Session, agent_version_id: str, tool_name: str, tool_input: dict[str, Any]
) -> dict[str, Any]:
    """Runs a tool only if it is loaded for this version. Raises
    ToolNotLoadedError otherwise, and LookupError for an unknown version."""
    for tool in load_agent_tools(session, agent_version_id):
        if tool.name == tool_name:
            return tool.call(**tool_input)
    raise ToolNotLoadedError(
        f"Tool {tool_name!r} is not loaded for agent version {agent_version_id}: "
        "its connector is not granted, or it is not on the agent's allow-list."
    )
