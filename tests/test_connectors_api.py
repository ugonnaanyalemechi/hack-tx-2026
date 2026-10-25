"""End-to-end tests for the connector endpoints (ticket #14): through the
HTTP API, checking what ends up in the database.
"""

from hack_tx_2026 import connectors
from hack_tx_2026.db.orm import Agent


def _headers(user_id: str) -> dict[str, str]:
    return {"X-User-Id": user_id}


def _make_agent(db_session, owner_id: str) -> Agent:
    agent = Agent(slug="filings-analyst", name="Filings Analyst", owner_id=owner_id)
    db_session.add(agent)
    db_session.commit()
    db_session.refresh(agent)
    return agent


def test_list_connectors_shows_the_fake_mcp_server(client, db_session) -> None:
    connectors.seed_fake_mcp_connector(db_session)

    response = client.get("/v1/connectors")

    assert response.status_code == 200
    body = response.json()
    assert body[0]["name"] == "fake-mcp"
    assert {t["name"]: t["side_effect"] for t in body[0]["tools"]} == {
        "lookup": False,
        "note": True,
    }


def test_grant_requires_admin(client, db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    agent = _make_agent(db_session, "usr_builder")

    response = client.post(
        f"/v1/connectors/{connector.id}/grants",
        json={"agent_id": agent.id},
        headers=_headers("usr_builder"),
    )

    assert response.status_code == 403


def test_admin_can_grant_and_revoke_a_connector_for_one_agent(client, db_session) -> None:
    connector = connectors.seed_fake_mcp_connector(db_session)
    agent = _make_agent(db_session, "usr_builder")

    grant = client.post(
        f"/v1/connectors/{connector.id}/grants",
        json={"agent_id": agent.id},
        headers=_headers("usr_admin"),
    )
    assert grant.status_code == 201
    assert grant.json()["revoked_at"] is None

    revoke = client.delete(
        f"/v1/connectors/{connector.id}/grants/{agent.id}", headers=_headers("usr_admin")
    )
    assert revoke.status_code == 204

    assert connectors.is_granted(db_session, connector.id, agent.id) is False
