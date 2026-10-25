"""The connector layer (ticket #14): load_agent_tools has no HTTP endpoint
of its own (it's a seam runtime calls directly, and runtime doesn't exist
yet), so these test the module directly — the exception CLAUDE.md allows
when no flow can reach the behavior.
"""

from hack_tx_2026 import connectors
from hack_tx_2026.db.orm import Agent, AgentVersion, User

SPEC = {
    "spec_version": 1,
    "name": "Filings Analyst",
    "slug": "filings-analyst",
    "description": "",
    "model": "gemini/gemini-3.8-flash",
    "instructions": "Answer questions.",
    "connectors": [{"name": "fake-mcp", "side_effect_tools": []}],
    "budget": {"monthly_cap": 50.0},
    "evals": {"min_score": 0.8},
}


def _make_agent_version(db_session, *, connector_spec=None) -> AgentVersion:
    owner = User(id="usr_owner", name="Owner", role="builder")
    admin = User(id="usr_admin", name="Admin", role="admin")
    db_session.add_all([owner, admin])
    db_session.flush()

    agent = Agent(slug="filings-analyst", name="Filings Analyst", owner_id=owner.id)
    db_session.add(agent)
    db_session.flush()

    spec = {**SPEC, "connectors": [connector_spec] if connector_spec else []}
    version = AgentVersion(agent_id=agent.id, version_number=1, spec=spec, status="draft")
    db_session.add(version)
    db_session.commit()
    db_session.refresh(version)
    return version


def test_ungranted_connectors_tools_are_never_loaded(db_session) -> None:
    connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(db_session, connector_spec={"name": "fake-mcp"})

    tools = connectors.load_agent_tools(db_session, version.id)

    assert tools == []


def test_granted_connector_loads_its_tools(db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(db_session, connector_spec={"name": "fake-mcp"})
    connectors.grant_connector(db_session, connector.id, version.agent_id, "usr_admin")

    tools = connectors.load_agent_tools(db_session, version.id)

    assert {t.name for t in tools} == {"lookup", "note"}


def test_allow_list_restricts_which_tools_load(db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(
        db_session, connector_spec={"name": "fake-mcp", "allow_list": ["lookup"]}
    )
    connectors.grant_connector(db_session, connector.id, version.agent_id, "usr_admin")

    tools = connectors.load_agent_tools(db_session, version.id)

    assert [t.name for t in tools] == ["lookup"]


def test_side_effect_tools_are_flagged(db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(db_session, connector_spec={"name": "fake-mcp"})
    connectors.grant_connector(db_session, connector.id, version.agent_id, "usr_admin")

    tools = {t.name: t.side_effect for t in connectors.load_agent_tools(db_session, version.id)}

    assert tools == {"lookup": False, "note": True}


def test_builder_spec_can_mark_an_additional_tool_as_a_side_effect(db_session) -> None:
    """The connector's own flag and the builder's spec both count — whichever
    is more cautious wins."""
    connector = connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(
        db_session,
        connector_spec={"name": "fake-mcp", "side_effect_tools": ["lookup"]},
    )
    connectors.grant_connector(db_session, connector.id, version.agent_id, "usr_admin")

    tools = {t.name: t.side_effect for t in connectors.load_agent_tools(db_session, version.id)}

    assert tools == {"lookup": True, "note": True}


def test_revoking_a_grant_stops_tools_from_loading(db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    version = _make_agent_version(db_session, connector_spec={"name": "fake-mcp"})
    connectors.grant_connector(db_session, connector.id, version.agent_id, "usr_admin")
    assert connectors.load_agent_tools(db_session, version.id) != []

    connectors.revoke_connector(db_session, connector.id, version.agent_id)

    assert connectors.load_agent_tools(db_session, version.id) == []
