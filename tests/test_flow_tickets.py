"""Tickets flow: flag tickets created through the seam, read, resolved, saved as test cases."""

import datetime as dt
import time

import pytest
import yaml
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import seams
from hack_tx_2026.db.orm import AgentVersion, Run

BUILDER = {"X-User-Id": "usr_builder"}
BUILDER_2 = {"X-User-Id": "usr_builder_2"}
ADMIN = {"X-User-Id": "usr_admin"}
END_USER = {"X-User-Id": "usr_end_user"}


def utc(day: int, hour: int = 12) -> dt.datetime:
    return dt.datetime(2026, 3, day, hour, 0, 0, tzinfo=dt.UTC)


def make_agent(client, slug: str, name: str, headers=BUILDER) -> str:
    spec = yaml.safe_dump(
        {
            "spec_version": 1,
            "name": name,
            "slug": slug,
            "description": f"{name} description",
            "model": "gemini/gemini-3.8-flash",
            "instructions": "Be helpful.",
            "budget": {"monthly_cap": 25.0},
            "evals": {"min_score": 0.8},
        }
    )
    r = client.post("/v1/agents", json={"spec_yaml": spec}, headers=headers)
    assert r.status_code == 201, r.text
    agent_id = r.json()["id"]
    d = client.post(f"/v1/agents/{agent_id}/versions/1/deploy", headers=headers)
    assert d.status_code == 200, d.text
    return agent_id


def add_run(db_session, agent_id: str, created_at: dt.datetime, entry_point: str = "chat") -> str:
    version = db_session.query(AgentVersion).filter_by(agent_id=agent_id).first()
    run = Run(
        agent_id=agent_id,
        agent_version_id=version.id,
        user_id="usr_end_user",
        entry_point=entry_point,
        status="completed",
        created_at=created_at,
    )
    db_session.add(run)
    db_session.commit()
    return run.id


def no_cost_keys(body) -> bool:
    if isinstance(body, dict):
        return all("cost" not in k and no_cost_keys(v) for k, v in body.items())
    if isinstance(body, list):
        return all(no_cost_keys(v) for v in body)
    return True


@pytest.fixture
def seam_db(test_engine, client, monkeypatch):
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seams, "SessionLocal", factory)


@pytest.fixture
def setup(client, db_session, seam_db):
    agent_id = make_agent(client, "tick-agent", "Tick Agent")
    run_id = add_run(db_session, agent_id, utc(1))
    recheck_id = add_run(db_session, agent_id, utc(1, 13), entry_point="recheck")
    ticket_id = seams.create_ticket(run_id, "What is the refund policy?", "30 days", "usr_end_user")
    seams.attach_recheck_run(ticket_id, recheck_id)
    return {
        "agent_id": agent_id,
        "run_id": run_id,
        "recheck_id": recheck_id,
        "ticket_id": ticket_id,
    }


def test_ticket_detail_links(client, setup):
    r = client.get(f"/v1/tickets/{setup['ticket_id']}", headers=BUILDER)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["question"] == "What is the refund policy?"
    assert body["answer"] == "30 days"
    assert body["run_id"] == setup["run_id"]
    assert body["recheck_run_id"] == setup["recheck_id"]
    assert body["agent_id"] == setup["agent_id"]
    assert body["agent_name"] == "Tick Agent"
    assert body["created_by"] == "usr_end_user"
    assert body["created_by_name"]
    assert body["status"] == "open"
    assert body["resolved_at"] is None
    assert no_cost_keys(body)


def test_seam_unknown_run(seam_db):
    with pytest.raises(LookupError):
        seams.create_ticket("run_missing", "q", "a", "usr_end_user")


def test_seam_attach_unknown_ticket(setup):
    with pytest.raises(LookupError):
        seams.attach_recheck_run("tkt_missing", setup["recheck_id"])
    with pytest.raises(LookupError):
        seams.attach_recheck_run(setup["ticket_id"], "run_missing")


@pytest.mark.parametrize(
    ("method", "suffix", "body"),
    [
        ("get", "", None),
        ("post", "/resolve", None),
        ("post", "/save-as-test-case", {"citation_required": True}),
    ],
)
def test_access_rules(client, setup, method, suffix, body):
    url = f"/v1/tickets/{setup['ticket_id']}{suffix}"
    kwargs = {"json": body} if body else {}
    for headers in (BUILDER_2, END_USER):
        r = getattr(client, method)(url, headers=headers, **kwargs)
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "forbidden"
    r = getattr(client, method)(url, **kwargs)
    assert r.status_code == 401


def test_owner_and_admin_allowed(client, setup):
    url = f"/v1/tickets/{setup['ticket_id']}"
    assert client.get(url, headers=BUILDER).status_code == 200
    assert client.get(url, headers=ADMIN).status_code == 200


def test_unknown_ticket_404(client, setup):
    for headers in (BUILDER, BUILDER_2, END_USER):
        r = client.get("/v1/tickets/tkt_missing", headers=headers)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "ticket_not_found"
    assert client.post("/v1/tickets/tkt_missing/resolve", headers=ADMIN).status_code == 404
    r = client.post("/v1/tickets/tkt_missing/save-as-test-case", json={}, headers=ADMIN)
    assert r.status_code == 404


def test_list_scoping(client, db_session, setup):
    other_agent = make_agent(client, "other-agent", "Other", headers=BUILDER_2)
    other_run = add_run(db_session, other_agent, utc(2))
    other_ticket = seams.create_ticket(other_run, "other q", "other a", "usr_end_user")

    admin = client.get("/v1/tickets", headers=ADMIN).json()
    assert {i["id"] for i in admin["items"]} == {setup["ticket_id"], other_ticket}
    mine = client.get("/v1/tickets", headers=BUILDER).json()
    assert [i["id"] for i in mine["items"]] == [setup["ticket_id"]]
    assert mine["items"][0]["agent_name"] == "Tick Agent"
    assert no_cost_keys(admin)
    assert client.get("/v1/tickets", headers=END_USER).status_code == 403

    r = client.get("/v1/tickets", params={"agent_id": other_agent}, headers=BUILDER)
    assert r.status_code == 403
    r = client.get("/v1/tickets", params={"agent_id": "agt_missing"}, headers=BUILDER)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"
    r = client.get("/v1/tickets", params={"agent_id": other_agent}, headers=BUILDER_2)
    assert [i["id"] for i in r.json()["items"]] == [other_ticket]
    assert client.get("/v1/tickets").status_code == 401


def test_list_status_filter(client, setup):
    client.post(f"/v1/tickets/{setup['ticket_id']}/resolve", headers=BUILDER)
    r = client.get("/v1/tickets", params={"status": "open"}, headers=BUILDER)
    assert r.json()["items"] == []
    r = client.get("/v1/tickets", params={"status": "resolved"}, headers=BUILDER)
    assert [i["id"] for i in r.json()["items"]] == [setup["ticket_id"]]
    r = client.get("/v1/tickets", params={"status": "bogus"}, headers=BUILDER)
    assert r.status_code == 422


def test_list_newest_first_and_paging(client, db_session, seam_db):
    agent_id = make_agent(client, "page-agent", "Page Agent")
    ids = []
    for day in (1, 2, 3):
        run_id = add_run(db_session, agent_id, utc(day))
        ids.append(seams.create_ticket(run_id, f"q{day}", "a", "usr_end_user"))
        time.sleep(0.01)  # keep created_at strictly ordered
    full = client.get("/v1/tickets", headers=BUILDER).json()
    assert [i["id"] for i in full["items"]] == list(reversed(ids))

    p1 = client.get("/v1/tickets", params={"limit": 2}, headers=BUILDER).json()
    assert [i["id"] for i in p1["items"]] == [ids[2], ids[1]]
    assert p1["next_cursor"]
    p2 = client.get(
        "/v1/tickets", params={"limit": 2, "cursor": p1["next_cursor"]}, headers=BUILDER
    ).json()
    assert [i["id"] for i in p2["items"]] == [ids[0]]
    assert p2["next_cursor"] is None

    r = client.get("/v1/tickets", params={"cursor": "!!!"}, headers=BUILDER)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_cursor"


def test_resolve_idempotent(client, setup):
    url = f"/v1/tickets/{setup['ticket_id']}/resolve"
    r1 = client.post(url, headers=BUILDER)
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "resolved"
    assert r1.json()["resolved_at"] is not None
    r2 = client.post(url, headers=ADMIN)
    assert r2.status_code == 200
    assert r2.json()["resolved_at"] == r1.json()["resolved_at"]
    assert r2.json()["status"] == "resolved"


def test_save_as_test_case(client, setup):
    url = f"/v1/tickets/{setup['ticket_id']}/save-as-test-case"
    r = client.post(
        url, json={"expected_strings": ["30 days"], "citation_required": True}, headers=BUILDER
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["origin"] == "flag"
    assert body["question"] == "What is the refund policy?"
    assert body["agent_id"] == setup["agent_id"]
    cases = client.get(f"/v1/agents/{setup['agent_id']}/eval-cases", headers=BUILDER).json()
    assert body["id"] in [c["id"] for c in cases["items"]]


def test_save_as_test_case_empty_checks(client, setup):
    url = f"/v1/tickets/{setup['ticket_id']}/save-as-test-case"
    r = client.post(url, json={}, headers=BUILDER)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "empty_eval_case"


def test_admin_queue_open_ticket(client, setup):
    items = client.get("/v1/admin/queue", headers=ADMIN).json()["items"]
    tickets = [i for i in items if i["kind"] == "open_ticket"]
    assert len(tickets) == 1
    t = tickets[0]
    assert t["ticket_id"] == setup["ticket_id"]
    assert t["agent_id"] == setup["agent_id"]
    assert t["agent_name"] == "Tick Agent"
    assert t["question"] == "What is the refund policy?"
    dt.datetime.fromisoformat(t["since"])

    client.post(f"/v1/tickets/{setup['ticket_id']}/resolve", headers=BUILDER)
    items = client.get("/v1/admin/queue", headers=ADMIN).json()["items"]
    assert not [i for i in items if i["kind"] == "open_ticket"]
