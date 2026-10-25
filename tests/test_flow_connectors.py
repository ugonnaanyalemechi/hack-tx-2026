"""Connector flow (ticket #14): an admin grants a connector to an agent
through the HTTP API, and the runtime's `load_agent_tools` seam then loads
only the granted, allow-listed tools, with side effects flagged.
"""

import pytest
import yaml
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import connectors, seams
from hack_tx_2026.db.orm import Connector

BUILDER = {"X-User-Id": "usr_builder"}
ADMIN = {"X-User-Id": "usr_admin"}


@pytest.fixture
def seam_db(test_engine, client, monkeypatch):
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seams, "SessionLocal", factory)


@pytest.fixture
def fake_mcp_id(db_session) -> str:
    return connectors.seed_fake_mcp_connector(db_session).id


def make_agent(client, connector: dict | None = None, slug: str = "conn-agent") -> str:
    spec = {
        "spec_version": 1,
        "name": "Conn Agent",
        "slug": slug,
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Be helpful.",
        "connectors": [connector] if connector else [],
        "budget": {"monthly_cap": 25.0},
        "evals": {"min_score": 0.8},
    }
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def version_id(agent_id: str) -> str:
    return seams.read_agent_version(agent_id, 1)["agent_version_id"]


def grant(client, connector_id: str, agent_id: str, headers=ADMIN):
    return client.post(
        f"/v1/connectors/{connector_id}/grants", json={"agent_id": agent_id}, headers=headers
    )


def revoke(client, connector_id: str, agent_id: str, headers=ADMIN):
    return client.delete(f"/v1/connectors/{connector_id}/grants/{agent_id}", headers=headers)


def loaded(agent_id: str) -> dict[str, bool]:
    return {t.name: t.side_effect for t in seams.load_agent_tools(version_id(agent_id))}


# --- Listing connectors ---


def test_list_connectors_shows_the_fake_mcp_server(client, fake_mcp_id) -> None:
    r = client.get("/v1/connectors", headers=BUILDER)

    assert r.status_code == 200
    body = r.json()
    assert body["next_cursor"] is None
    [fake] = body["items"]
    assert fake["id"] == fake_mcp_id
    assert fake["name"] == "fake-mcp"
    assert {t["name"]: t["side_effect"] for t in fake["tools"]} == {
        "lookup": False,
        "note": True,
    }


@pytest.mark.parametrize("connector_name", ["fake-mcp", "filings-demo"])
def test_listed_tools_match_the_loaded_tools_description_and_input_schema(
    client, db_session, seam_db, connector_name
) -> None:
    connectors.seed_fake_mcp_connector(db_session)
    connectors.seed_filings_demo_connector(db_session)
    body = client.get("/v1/connectors", headers=BUILDER).json()
    [listed] = [c for c in body["items"] if c["name"] == connector_name]
    agent_id = make_agent(client, {"name": connector_name})
    grant(client, listed["id"], agent_id)

    loaded_tools = {
        t.name: {"description": t.description, "input_schema": t.input_schema}
        for t in seams.load_agent_tools(version_id(agent_id))
    }
    listed_tools = {
        t["name"]: {"description": t["description"], "input_schema": t["input_schema"]}
        for t in listed["tools"]
    }

    assert loaded_tools
    assert listed_tools == loaded_tools
    assert all(t["description"] for t in listed_tools.values())


def test_a_listed_tool_with_no_server_definition_gets_defaults(client, db_session) -> None:
    db_session.add(
        Connector(
            name="unserved-mcp", description="", tools=[{"name": "fetch", "side_effect": False}]
        )
    )
    db_session.commit()

    [unserved] = client.get("/v1/connectors", headers=BUILDER).json()["items"]

    assert unserved["tools"] == [
        {
            "name": "fetch",
            "side_effect": False,
            "description": "",
            "input_schema": {"type": "object"},
        }
    ]


def test_connector_list_pages_by_name(client, db_session, fake_mcp_id) -> None:
    db_session.add(Connector(name="another-mcp", description="", tools=[]))
    db_session.commit()

    first = client.get("/v1/connectors", params={"limit": 1}, headers=BUILDER).json()
    second = client.get(
        "/v1/connectors", params={"limit": 1, "cursor": first["next_cursor"]}, headers=BUILDER
    ).json()

    assert [c["name"] for c in first["items"]] == ["another-mcp"]
    assert first["next_cursor"] is not None
    assert [c["name"] for c in second["items"]] == ["fake-mcp"]
    assert second["next_cursor"] is None


def test_listing_connectors_needs_an_identity(client, fake_mcp_id) -> None:
    r = client.get("/v1/connectors")

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "missing_identity"


# --- Granting and revoking ---


def test_grant_requires_admin(client, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})

    r = grant(client, fake_mcp_id, agent_id, headers=BUILDER)

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


def test_revoke_requires_admin(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_mcp_id, agent_id)

    r = revoke(client, fake_mcp_id, agent_id, headers=BUILDER)

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"
    assert loaded(agent_id) == {"lookup": False, "note": True}


def test_granting_an_unknown_connector_is_not_found(client, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})

    r = grant(client, "con_missing", agent_id)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "connector_not_found"


def test_granting_to_an_unknown_agent_is_not_found(client, fake_mcp_id) -> None:
    r = grant(client, fake_mcp_id, "agt_missing")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"


def test_revoking_without_an_active_grant_is_not_found(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_mcp_id, agent_id)
    assert revoke(client, fake_mcp_id, agent_id).status_code == 204

    r = revoke(client, fake_mcp_id, agent_id)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "grant_not_found"


def test_granting_twice_keeps_one_active_grant(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})
    first = grant(client, fake_mcp_id, agent_id)

    second = grant(client, fake_mcp_id, agent_id)

    assert second.json()["id"] == first.json()["id"]
    assert revoke(client, fake_mcp_id, agent_id).status_code == 204
    assert loaded(agent_id) == {}


def test_granting_needs_an_identity(client, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})

    r = grant(client, fake_mcp_id, agent_id, headers={})

    assert r.status_code == 401
    assert r.json()["error"]["code"] == "missing_identity"


def test_admin_can_grant_and_revoke_a_connector_for_one_agent(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})

    g = grant(client, fake_mcp_id, agent_id)
    assert g.status_code == 201, g.text
    assert g.json()["agent_id"] == agent_id
    assert g.json()["granted_by"] == "usr_admin"
    assert g.json()["revoked_at"] is None
    assert loaded(agent_id) != {}

    r = revoke(client, fake_mcp_id, agent_id)
    assert r.status_code == 204
    assert loaded(agent_id) == {}


# --- Loading an agent's tools through the seam ---


def test_ungranted_connectors_tools_are_never_loaded(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})

    assert loaded(agent_id) == {}


def test_granted_connector_loads_its_tools_with_side_effects_flagged(
    client, seam_db, fake_mcp_id
) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_mcp_id, agent_id)

    assert loaded(agent_id) == {"lookup": False, "note": True}


def test_allow_list_restricts_which_tools_load(client, seam_db, fake_mcp_id) -> None:
    agent_id = make_agent(client, {"name": "fake-mcp", "allow_list": ["lookup"]})
    grant(client, fake_mcp_id, agent_id)

    assert loaded(agent_id) == {"lookup": False}


def test_builder_spec_can_mark_an_additional_tool_as_a_side_effect(
    client, seam_db, fake_mcp_id
) -> None:
    """The connector's own flag and the builder's spec both count — whichever
    is more cautious wins."""
    agent_id = make_agent(client, {"name": "fake-mcp", "side_effect_tools": ["lookup"]})
    grant(client, fake_mcp_id, agent_id)

    assert loaded(agent_id) == {"lookup": True, "note": True}


def test_a_grant_covers_only_the_agent_it_was_given_to(client, seam_db, fake_mcp_id) -> None:
    granted = make_agent(client, {"name": "fake-mcp"}, slug="granted-agent")
    other = make_agent(client, {"name": "fake-mcp"}, slug="other-agent")
    grant(client, fake_mcp_id, granted)

    assert loaded(granted) == {"lookup": False, "note": True}
    assert loaded(other) == {}


def test_a_loaded_tool_runs_under_the_connectors_own_account(client, seam_db, fake_mcp_id) -> None:
    """A call carries only the tool's arguments, never the chatting user:
    the connector acts under its own account (user story 63)."""
    agent_id = make_agent(client, {"name": "fake-mcp"})
    grant(client, fake_mcp_id, agent_id)
    tools = {t.name: t for t in seams.load_agent_tools(version_id(agent_id))}

    note = tools["note"].call(text="Q2 revenue looked off")
    lookup = tools["lookup"].call(query="revenue 2026-Q2")

    assert note["status"] == "recorded"
    assert note["account"] == "svc_fake_mcp"
    assert "revenue 2026-Q2" in lookup["result"]


def test_a_granted_connector_with_no_server_loads_no_tools(client, db_session, seam_db) -> None:
    """Nothing could run its tools, so the runtime is never offered them."""
    unserved = Connector(
        name="unserved-mcp", description="", tools=[{"name": "fetch", "side_effect": False}]
    )
    db_session.add(unserved)
    db_session.commit()
    agent_id = make_agent(client, {"name": "unserved-mcp"})
    assert grant(client, unserved.id, agent_id).status_code == 201

    assert loaded(agent_id) == {}


def test_loading_tools_for_an_unknown_version_raises_lookup_error(client, seam_db) -> None:
    with pytest.raises(LookupError):
        seams.load_agent_tools("ver_missing")


# --- Listing grants ---


def test_admin_lists_active_grants_and_revoked_ones_are_left_out(
    client, seam_db, fake_mcp_id
) -> None:
    kept = make_agent(client, {"name": "fake-mcp"}, slug="kept")
    dropped = make_agent(client, {"name": "fake-mcp"}, slug="dropped")
    grant(client, fake_mcp_id, kept)
    grant(client, fake_mcp_id, dropped)
    revoke(client, fake_mcp_id, dropped)

    r = client.get("/v1/connectors/grants", headers=ADMIN)

    assert r.status_code == 200
    items = r.json()["items"]
    assert [(g["connector_id"], g["agent_id"]) for g in items] == [(fake_mcp_id, kept)]
    assert items[0]["granted_by"] == "usr_admin"
    assert items[0]["revoked_at"] is None
    assert r.json()["next_cursor"] is None


@pytest.mark.parametrize("who", [BUILDER, {"X-User-Id": "usr_end_user"}])
def test_listing_grants_requires_admin(client, fake_mcp_id, who) -> None:
    r = client.get("/v1/connectors/grants", headers=who)

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"


def test_grant_list_pages_with_a_cursor(client, seam_db, fake_mcp_id) -> None:
    agents = {make_agent(client, {"name": "fake-mcp"}, slug=f"a{i}") for i in range(3)}
    for agent_id in agents:
        grant(client, fake_mcp_id, agent_id)

    seen: set[str] = set()
    cursor = None
    pages = 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        body = client.get("/v1/connectors/grants", params=params, headers=ADMIN).json()
        seen |= {g["agent_id"] for g in body["items"]}
        pages += 1
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert pages == 2
    assert seen == agents
