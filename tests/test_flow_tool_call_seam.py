"""Tool-call seam (ticket #51): the runtime calls `seams.call_agent_tool`
with an agent version, a tool name and its input. Only tools loaded for that
version run; loaded tools carry a description and an input JSON Schema.
"""

import pytest
import yaml
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import connectors, seams
from hack_tx_2026.seed import seed_demo

ADMIN = {"X-User-Id": "usr_admin"}
BUILDER = {"X-User-Id": "usr_builder"}


def make_agent(client, connector: dict) -> str:
    spec = {
        "spec_version": 1,
        "name": "Seam Agent",
        "slug": "seam-agent",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Be helpful.",
        "connectors": [connector],
        "budget": {"monthly_cap": 25.0},
        "evals": {"min_score": 0.8},
    }
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def version_id(agent_id: str) -> str:
    return seams.read_agent_version(agent_id, 1)["agent_version_id"]


def grant(client, connector_id: str, agent_id: str) -> None:
    r = client.post(
        f"/v1/connectors/{connector_id}/grants", json={"agent_id": agent_id}, headers=ADMIN
    )
    assert r.status_code < 300, r.text


def revoke(client, connector_id: str, agent_id: str) -> None:
    r = client.delete(f"/v1/connectors/{connector_id}/grants/{agent_id}", headers=ADMIN)
    assert r.status_code < 300, r.text


@pytest.fixture
def seam_db(test_engine, client, monkeypatch):
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seams, "SessionLocal", factory)


def demo_version_id(db_session) -> str:
    return seams.read_agent_version(seed_demo(db_session), 1)["agent_version_id"]


def test_runtime_calls_a_loaded_demo_tool_through_the_seam(client, db_session, seam_db) -> None:
    vid = demo_version_id(db_session)

    result = seams.call_agent_tool(
        vid, "lookup_filing", {"company": "larkspur", "quarter": "Q2 2026"}
    )

    assert result["found"] is True
    assert result["citation"] == "FCT-LARK-2026Q2"


def test_runtime_calls_a_side_effect_tool_through_the_seam(client, db_session, seam_db) -> None:
    vid = demo_version_id(db_session)

    result = seams.call_agent_tool(vid, "save_note", {"text": "hello"})

    assert result["status"] == "recorded"


def test_calling_an_unknown_tool_is_refused_clearly(client, db_session, seam_db) -> None:
    vid = demo_version_id(db_session)

    with pytest.raises(connectors.ToolNotLoadedError, match="no_such_tool"):
        seams.call_agent_tool(vid, "no_such_tool", {})


def test_calling_a_tool_off_the_allow_list_is_refused(client, seam_db, db_session) -> None:
    fake_id = connectors.seed_fake_mcp_connector(db_session).id
    agent_id = make_agent(client, {"name": "fake-mcp", "allow_list": ["lookup"]})
    grant(client, fake_id, agent_id)

    assert seams.call_agent_tool(version_id(agent_id), "lookup", {"query": "x"})["result"]
    with pytest.raises(connectors.ToolNotLoadedError, match="note"):
        seams.call_agent_tool(version_id(agent_id), "note", {"text": "x"})


def test_calling_a_tool_of_an_ungranted_connector_is_refused(client, seam_db, db_session) -> None:
    connectors.seed_fake_mcp_connector(db_session)
    agent_id = make_agent(client, {"name": "fake-mcp"})

    with pytest.raises(connectors.ToolNotLoadedError):
        seams.call_agent_tool(version_id(agent_id), "lookup", {"query": "x"})


def test_calling_a_tool_after_its_grant_is_revoked_is_refused(client, seam_db, db_session) -> None:
    fake_id = connectors.seed_fake_mcp_connector(db_session).id
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_id, agent_id)
    revoke(client, fake_id, agent_id)

    with pytest.raises(connectors.ToolNotLoadedError):
        seams.call_agent_tool(version_id(agent_id), "lookup", {"query": "x"})


def test_calling_a_tool_for_an_unknown_version_raises_lookup_error(client, seam_db) -> None:
    with pytest.raises(LookupError):
        seams.call_agent_tool("ver_missing", "lookup", {})


def test_loaded_tools_carry_a_description_and_input_schema(client, db_session, seam_db) -> None:
    tools = {t.name: t for t in seams.load_agent_tools(demo_version_id(db_session))}

    lookup = tools["lookup_filing"]
    assert lookup.description
    assert lookup.input_schema["type"] == "object"
    assert set(lookup.input_schema["required"]) == {"company", "quarter"}
    assert lookup.input_schema["properties"]["company"]["type"] == "string"
    assert tools["save_note"].input_schema["required"] == ["text"]


def test_fake_mcp_tools_carry_a_description_and_input_schema(client, db_session, seam_db) -> None:
    fake_id = connectors.seed_fake_mcp_connector(db_session).id
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_id, agent_id)

    tools = {t.name: t for t in seams.load_agent_tools(version_id(agent_id))}

    assert tools["lookup"].description
    assert tools["lookup"].input_schema["required"] == ["query"]
    assert tools["note"].description
    assert tools["note"].input_schema["required"] == ["text"]
