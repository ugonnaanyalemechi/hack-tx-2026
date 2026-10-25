"""Admin reads flow: catalog, run log, run detail and usage."""

import datetime as dt
from decimal import Decimal

import pytest
import yaml

from hack_tx_2026.db.orm import AgentVersion, Approval, Run, RunStep

BUILDER = {"X-User-Id": "usr_builder"}
BUILDER_2 = {"X-User-Id": "usr_builder_2"}
ADMIN = {"X-User-Id": "usr_admin"}
END_USER = {"X-User-Id": "usr_end_user"}


def utc(day: int, hour: int = 12, minute: int = 0, second: int = 0) -> dt.datetime:
    return dt.datetime(2026, 3, day, hour, minute, second, tzinfo=dt.UTC)


def spec_yaml(slug: str, name: str) -> str:
    return yaml.safe_dump(
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


def make_agent(client, slug: str, name: str, headers=BUILDER, deploy: bool = True) -> str:
    r = client.post("/v1/agents", json={"spec_yaml": spec_yaml(slug, name)}, headers=headers)
    assert r.status_code == 201, r.text
    agent_id = r.json()["id"]
    if deploy:
        d = client.post(f"/v1/agents/{agent_id}/versions/1/deploy", headers=headers)
        assert d.status_code == 200, d.text
    return agent_id


def add_run(
    db_session,
    agent_id: str,
    created_at: dt.datetime,
    cost: str = "0.000000",
    finished_after_ms: int | None = 1500,
    user_id: str = "usr_end_user",
    entry_point: str = "chat",
    status: str = "completed",
) -> str:
    version = db_session.query(AgentVersion).filter_by(agent_id=agent_id).first()
    run = Run(
        agent_id=agent_id,
        agent_version_id=version.id,
        user_id=user_id,
        entry_point=entry_point,
        status=status,
        cost_total=Decimal(cost),
        created_at=created_at,
        finished_at=(
            None
            if finished_after_ms is None
            else created_at + dt.timedelta(milliseconds=finished_after_ms)
        ),
    )
    db_session.add(run)
    db_session.commit()
    return run.id


def all_keys(value) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        for k, v in value.items():
            keys.add(k)
            keys |= all_keys(v)
    elif isinstance(value, list):
        for v in value:
            keys |= all_keys(v)
    return keys


def no_cost_keys(body) -> bool:
    return not any("cost" in k for k in all_keys(body))


# --- catalog ----------------------------------------------------------------


def test_catalog_lists_only_deployed_agents_for_end_user(client) -> None:
    live = make_agent(client, "alpha", "Alpha")
    make_agent(client, "draft-only", "Draft", deploy=False)

    r = client.get("/v1/catalog", headers=END_USER)

    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["id"] for i in items] == [live]
    assert items[0] == {
        "id": live,
        "slug": "alpha",
        "name": "Alpha",
        "description": "Alpha description",
        "owner_id": "usr_builder",
        "live_version_number": 1,
    }
    assert no_cost_keys(r.json())


def test_catalog_pages_by_slug(client) -> None:
    make_agent(client, "aaa", "A")
    make_agent(client, "bbb", "B")

    first = client.get("/v1/catalog?limit=1", headers=END_USER).json()
    assert [i["slug"] for i in first["items"]] == ["aaa"]
    assert first["next_cursor"]

    second = client.get(f"/v1/catalog?limit=1&cursor={first['next_cursor']}", headers=END_USER)
    body = second.json()
    assert [i["slug"] for i in body["items"]] == ["bbb"]
    assert body["next_cursor"] is None


def test_catalog_bad_cursor_is_422(client) -> None:
    r = client.get("/v1/catalog?cursor=%25%25%25", headers=END_USER)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_cursor"


def test_catalog_requires_identity(client) -> None:
    assert client.get("/v1/catalog").status_code == 401


# --- run list ---------------------------------------------------------------


def test_runs_list_as_admin_newest_first_with_computed_fields(client, db_session) -> None:
    agent_id = make_agent(client, "alpha", "Alpha")
    old = add_run(db_session, agent_id, utc(1), cost="0.012345", finished_after_ms=2500)
    new = add_run(db_session, agent_id, utc(2), cost="1.5", user_id="usr_admin", entry_point="api")

    r = client.get("/v1/runs", headers=ADMIN)

    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["id"] for i in items] == [new, old]
    assert items[1]["agent_id"] == agent_id
    assert items[1]["user_id"] == "usr_end_user"
    assert items[1]["entry_point"] == "chat"
    assert items[1]["status"] == "completed"
    assert items[1]["duration_ms"] == 2500
    assert items[1]["cost_total"] == "0.012345"
    assert items[0]["entry_point"] == "api"
    assert items[0]["user_id"] == "usr_admin"
    assert items[0]["cost_total"] == "1.500000"


def test_unfinished_run_has_null_duration(client, db_session) -> None:
    agent_id = make_agent(client, "alpha", "Alpha")
    add_run(db_session, agent_id, utc(1), finished_after_ms=None, status="running")

    items = client.get("/v1/runs", headers=ADMIN).json()["items"]

    assert items[0]["duration_ms"] is None


def test_runs_list_cursor_paging_has_no_duplicates_or_gaps(client, db_session) -> None:
    agent_id = make_agent(client, "alpha", "Alpha")
    # Two runs share a timestamp, so the id tiebreak matters.
    ids = [add_run(db_session, agent_id, utc(d)) for d in (1, 2, 3, 3, 4)]

    seen: list[str] = []
    cursor = None
    for _ in range(10):
        url = "/v1/runs?limit=2" + (f"&cursor={cursor}" if cursor else "")
        body = client.get(url, headers=ADMIN).json()
        seen += [i["id"] for i in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert len(seen) == 5
    assert sorted(seen) == sorted(ids)
    assert seen[0] == ids[4]
    assert seen[-1] == ids[0]


def test_runs_list_filter_by_agent(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha")
    b = make_agent(client, "beta", "Beta", headers=BUILDER_2)
    ra = add_run(db_session, a, utc(1))
    add_run(db_session, b, utc(2))

    items = client.get(f"/v1/runs?agent_id={a}", headers=ADMIN).json()["items"]

    assert [i["id"] for i in items] == [ra]


def test_builder_owner_sees_own_runs_and_non_owner_is_forbidden(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha", headers=BUILDER)
    b = make_agent(client, "beta", "Beta", headers=BUILDER_2)
    ra = add_run(db_session, a, utc(1), cost="0.5")
    rb = add_run(db_session, b, utc(2), cost="0.7")

    own = client.get(f"/v1/runs?agent_id={a}", headers=BUILDER)
    assert own.status_code == 200
    assert [i["id"] for i in own.json()["items"]] == [ra]
    assert own.json()["items"][0]["cost_total"] == "0.500000"

    denied = client.get(f"/v1/runs?agent_id={a}", headers=BUILDER_2)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"
    assert no_cost_keys(denied.json())

    unfiltered = client.get("/v1/runs", headers=BUILDER_2).json()["items"]
    assert [i["id"] for i in unfiltered] == [rb]


def test_builder_with_no_owned_runs_gets_empty_list(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha", headers=BUILDER)
    add_run(db_session, a, utc(1))

    r = client.get("/v1/runs", headers=BUILDER_2)

    assert r.status_code == 200
    assert r.json() == {"items": [], "next_cursor": None}


def test_end_user_forbidden_on_admin_reads(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha")
    run_id = add_run(db_session, a, utc(1), cost="0.9")

    for path in ("/v1/runs", f"/v1/runs?agent_id={a}", f"/v1/runs/{run_id}", "/v1/usage"):
        r = client.get(path, headers=END_USER)
        assert r.status_code == 403, path
        assert r.json()["error"]["code"] == "forbidden"
        assert no_cost_keys(r.json())


def test_unknown_agent_and_run_are_404_and_missing_identity_is_401(client) -> None:
    r = client.get("/v1/runs?agent_id=agt_nope", headers=ADMIN)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"

    r = client.get("/v1/usage?agent_id=agt_nope", headers=ADMIN)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"

    r = client.get("/v1/runs/run_nope", headers=ADMIN)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "run_not_found"

    assert client.get("/v1/runs").status_code == 401
    assert client.get("/v1/runs/run_nope").status_code == 401
    assert client.get("/v1/usage").status_code == 401


# --- run detail -------------------------------------------------------------


def add_step(db_session, run_id: str, sequence: int, kind: str, name: str, **kw) -> str:
    step = RunStep(run_id=run_id, sequence=sequence, kind=kind, name=name, **kw)
    db_session.add(step)
    db_session.commit()
    return step.id


def add_approval(db_session, run_id: str, tool: str, created_at: dt.datetime, **kw) -> str:
    approval = Approval(run_id=run_id, tool_name=tool, tool_input={}, created_at=created_at, **kw)
    db_session.add(approval)
    db_session.commit()
    return approval.id


def test_run_detail_orders_steps_and_includes_cost_fields(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha")
    run_id = add_run(db_session, a, utc(1), cost="0.25")
    add_step(db_session, run_id, 2, "tool", "lookup", latency_ms=40, error="boom")
    add_step(
        db_session,
        run_id,
        1,
        "model",
        "gemini",
        input_tokens=100,
        cached_input_tokens=20,
        output_tokens=30,
        cost=Decimal("0.25"),
        latency_ms=900,
    )

    for headers in (ADMIN, BUILDER):
        r = client.get(f"/v1/runs/{run_id}", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["run"]["id"] == run_id
        assert body["run"]["cost_total"] == "0.250000"
        steps = body["steps"]
        assert [s["sequence"] for s in steps] == [1, 2]
        assert steps[0]["input_tokens"] == 100
        assert steps[0]["cached_input_tokens"] == 20
        assert steps[0]["output_tokens"] == 30
        assert steps[0]["cost"] == "0.250000"
        assert steps[0]["latency_ms"] == 900
        assert steps[0]["error"] is None
        assert steps[0]["approval"] is None
        assert steps[1]["error"] == "boom"
        assert steps[1]["cost"] is None
        assert steps[1]["approval"] is None

    denied = client.get(f"/v1/runs/{run_id}", headers=BUILDER_2)
    assert denied.status_code == 403
    assert no_cost_keys(denied.json())


def test_run_detail_pairs_approval_steps_with_approvals_in_order(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha")
    run_id = add_run(db_session, a, utc(1))
    add_step(db_session, run_id, 1, "model", "gemini")
    add_step(db_session, run_id, 2, "approval", "approve send")
    add_step(db_session, run_id, 3, "approval", "approve wire")
    # Insert approvals out of creation order to check (created_at, id) pairing.
    second = add_approval(db_session, run_id, "wire", utc(1, 12, 5), status="pending")
    first = add_approval(
        db_session,
        run_id,
        "send",
        utc(1, 12, 1),
        status="approved",
        decided_by="usr_admin",
        decided_at=utc(1, 12, 2),
    )

    steps = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()["steps"]

    assert steps[0]["approval"] is None
    assert steps[1]["approval"] == {
        "id": first,
        "tool_name": "send",
        "status": "approved",
        "decided_by": "usr_admin",
        "decided_by_name": "Ada Admin",
        "decided_at": "2026-03-01T12:02:00Z",
    }
    assert steps[2]["approval"] == {
        "id": second,
        "tool_name": "wire",
        "status": "pending",
        "decided_by": None,
        "decided_by_name": None,
        "decided_at": None,
    }


def test_run_detail_matches_approval_by_id_in_step_input(client, db_session) -> None:
    a = make_agent(client, "alpha", "Alpha")
    run_id = add_run(db_session, a, utc(1))
    early = add_approval(
        db_session,
        run_id,
        "send",
        utc(1, 12, 1),
        status="rejected",
        decided_by="usr_end_user",
        decided_at=utc(1, 12, 3),
    )
    late = add_approval(
        db_session,
        run_id,
        "wire",
        utc(1, 12, 5),
        status="approved",
        decided_by="usr_admin",
        decided_at=utc(1, 12, 6),
    )
    # The only approval step points at the later approval, not the first by order.
    add_step(db_session, run_id, 1, "approval", "approve", input={"approval_id": late})

    steps = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()["steps"]

    assert steps[0]["approval"]["id"] == late
    assert steps[0]["approval"]["decided_by_name"] == "Ada Admin"
    assert early != late


def test_run_detail_ordered_pairing_skips_explicitly_referenced_approvals(
    client, db_session
) -> None:
    a = make_agent(client, "alpha", "Alpha")
    run_id = add_run(db_session, a, utc(1))
    first = add_approval(db_session, run_id, "send", utc(1, 12, 1))
    second = add_approval(db_session, run_id, "wire", utc(1, 12, 2))
    third = add_approval(db_session, run_id, "note", utc(1, 12, 3))
    add_step(db_session, run_id, 1, "approval", "approve", input={"approval_id": second})
    add_step(db_session, run_id, 2, "approval", "approve")
    add_step(db_session, run_id, 3, "approval", "approve")

    steps = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()["steps"]

    assert [s["approval"]["id"] for s in steps] == [second, first, third]


# --- usage ------------------------------------------------------------------


@pytest.fixture
def usage_setup(client, db_session) -> dict[str, str]:
    a = make_agent(client, "alpha", "Alpha", headers=BUILDER)
    b = make_agent(client, "beta", "Beta", headers=BUILDER_2)
    add_run(db_session, a, utc(1, 23, 30), cost="0.100001")
    add_run(db_session, a, utc(2, 0, 30), cost="0.200002")
    add_run(db_session, b, utc(2, 10), cost="1.000004")
    return {"a": a, "b": b}


def test_usage_admin_sums_by_agent_and_day(client, usage_setup) -> None:
    r = client.get("/v1/usage", headers=ADMIN)

    assert r.status_code == 200
    body = r.json()
    assert body["by_agent"] == [
        {"agent_id": usage_setup["a"], "agent_name": "Alpha", "runs": 2, "cost": "0.300003"},
        {"agent_id": usage_setup["b"], "agent_name": "Beta", "runs": 1, "cost": "1.000004"},
    ]
    assert body["by_day"] == [
        {"day": "2026-03-01", "runs": 1, "cost": "0.100001"},
        {"day": "2026-03-02", "runs": 2, "cost": "1.200006"},
    ]


def test_usage_builder_sees_only_own_agents(client, usage_setup) -> None:
    body = client.get("/v1/usage", headers=BUILDER).json()

    assert [a["agent_id"] for a in body["by_agent"]] == [usage_setup["a"]]
    assert body["by_day"] == [
        {"day": "2026-03-01", "runs": 1, "cost": "0.100001"},
        {"day": "2026-03-02", "runs": 1, "cost": "0.200002"},
    ]


def test_usage_agent_filter_restricts_and_enforces_access(client, usage_setup) -> None:
    body = client.get(f"/v1/usage?agent_id={usage_setup['b']}", headers=ADMIN).json()
    assert [a["agent_id"] for a in body["by_agent"]] == [usage_setup["b"]]
    assert body["by_day"] == [{"day": "2026-03-02", "runs": 1, "cost": "1.000004"}]

    denied = client.get(f"/v1/usage?agent_id={usage_setup['b']}", headers=BUILDER)
    assert denied.status_code == 403
    assert no_cost_keys(denied.json())
