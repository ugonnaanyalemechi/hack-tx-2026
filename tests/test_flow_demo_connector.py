"""Demo connector flow (ticket #46): the connector layer serves the seeded
`filings-demo` connector exactly like the fake MCP server. The runtime's
`load_agent_tools` seam loads the demo agent's tools, and calling one runs
it against the synthetic filings.
"""

import pytest
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import connectors, seams
from hack_tx_2026.seed import seed_demo

ADMIN = {"X-User-Id": "usr_admin"}
BUILDER = {"X-User-Id": "usr_builder"}


@pytest.fixture
def seam_db(test_engine, client, monkeypatch):
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seams, "SessionLocal", factory)


def demo_tools(agent_id: str) -> dict[str, seams.Tool]:
    version_id = seams.read_agent_version(agent_id, 1)["agent_version_id"]
    return {t.name: t for t in seams.load_agent_tools(version_id)}


def filings_demo_id(client) -> str:
    items = client.get("/v1/connectors", headers=ADMIN).json()["items"]
    return next(c["id"] for c in items if c["name"] == "filings-demo")


def test_seeded_demo_agent_loads_its_filings_tools(client, db_session, seam_db) -> None:
    agent_id = seed_demo(db_session)

    tools = demo_tools(agent_id)

    assert {name: t.side_effect for name, t in tools.items()} == {
        "lookup_filing": False,
        "save_note": True,
    }


def test_a_loaded_filings_tool_returns_the_synthetic_filing(client, db_session, seam_db) -> None:
    tools = demo_tools(seed_demo(db_session))

    result = tools["lookup_filing"].call(company="larkspur", quarter="Q2 2026")

    assert result["found"] is True
    assert result["citation"] == "FCT-LARK-2026Q2"
    assert result["filing"]["company"] == "Larkspur Widget Co."
    assert result["filing"]["revenue"] == "$48.2 million"


def test_a_loaded_save_note_tool_records_the_note(client, db_session, seam_db) -> None:
    tools = demo_tools(seed_demo(db_session))

    result = tools["save_note"].call(text="Larkspur raised guidance in 2026-Q2")

    assert result["status"] == "recorded"
    assert result["note_id"].startswith("note_")


def test_revoking_the_grant_stops_the_demo_tools_loading(client, db_session, seam_db) -> None:
    agent_id = seed_demo(db_session)

    r = client.delete(f"/v1/connectors/{filings_demo_id(client)}/grants/{agent_id}", headers=ADMIN)

    assert r.status_code == 204
    assert demo_tools(agent_id) == {}


def test_an_ungranted_copy_of_the_demo_agent_loads_no_tools(client, db_session, seam_db) -> None:
    """The copy names filings-demo in its spec, but no admin granted it."""
    demo_id = seed_demo(db_session)
    r = client.post(f"/v1/agents/{demo_id}/copy", json={"slug": "filings-copy"}, headers=BUILDER)
    assert r.status_code == 201, r.text

    assert demo_tools(r.json()["id"]) == {}


def test_seeding_keeps_one_filings_demo_connector_whichever_seeds_first(
    client, db_session, seam_db
) -> None:
    connectors.seed_filings_demo_connector(db_session)
    agent_id = seed_demo(db_session)
    seed_demo(db_session)
    connectors.seed_filings_demo_connector(db_session)

    items = client.get("/v1/connectors", headers=ADMIN).json()["items"]
    assert [(c["name"], {t["name"]: t["side_effect"] for t in c["tools"]}) for c in items] == [
        ("filings-demo", {"lookup_filing": False, "save_note": True})
    ]
    assert set(demo_tools(agent_id)) == {"lookup_filing", "save_note"}
