"""Budget flow: spend states, period rules, admin approval and the admin queue."""

import datetime as dt
from decimal import Decimal

import pytest
import yaml
from sqlalchemy import select

from hack_tx_2026.db.orm import AgentVersion, Run

BUILDER = {"X-User-Id": "usr_builder"}
BUILDER_2 = {"X-User-Id": "usr_builder_2"}
ADMIN = {"X-User-Id": "usr_admin"}
END_USER = {"X-User-Id": "usr_end_user"}


def spec_yaml(slug: str, name: str, budget: dict) -> str:
    return yaml.safe_dump(
        {
            "spec_version": 1,
            "name": name,
            "slug": slug,
            "description": "Answers tax questions",
            "model": "gemini/gemini-3.8-flash",
            "instructions": "Be helpful and cite sources.",
            "budget": budget,
            "evals": {"min_score": 0.8},
        }
    )


def create_agent(client, slug: str = "tax-helper", name: str = "Tax Helper", **budget) -> str:
    budget = {"monthly_cap": 10.0, **budget}
    r = client.post(
        "/v1/agents", json={"spec_yaml": spec_yaml(slug, name, budget)}, headers=BUILDER
    )
    assert r.status_code == 201
    return r.json()["id"]


def record_run_cost(db_session, agent_id: str, cost: str, created_at=None) -> None:
    """TEST SETUP ONLY: insert a finished run with a chosen cost.

    Runs are written by owner:runtime and there is no write API yet, so this
    stands in for the fake model's metered spend.
    """
    version_id = db_session.scalar(select(AgentVersion.id).where(AgentVersion.agent_id == agent_id))
    run = Run(
        agent_id=agent_id,
        agent_version_id=version_id,
        user_id="usr_end_user",
        entry_point="chat",
        status="completed",
        cost_total=Decimal(cost),
    )
    if created_at is not None:
        run.created_at = created_at
    db_session.add(run)
    db_session.commit()


def budget(client, agent_id: str, headers=ADMIN) -> dict:
    r = client.get(f"/v1/agents/{agent_id}/budget", headers=headers)
    assert r.status_code == 200
    return r.json()


def approve(client, agent_id: str, body=None, headers=ADMIN):
    return client.post(f"/v1/agents/{agent_id}/budget/approve", json=body, headers=headers)


def queue_items(client) -> list[dict]:
    r = client.get("/v1/admin/queue", headers=ADMIN)
    assert r.status_code == 200
    return r.json()["items"]


def test_new_agent_budget_is_lazily_created_ok(client) -> None:
    agent_id = create_agent(client)

    b = budget(client, agent_id)

    assert b["agent_id"] == agent_id
    assert b["agent_name"] == "Tax Helper"
    assert b["state"] == "ok"
    assert Decimal(b["spent"]) == 0
    assert Decimal(b["cap"]) == 10
    assert Decimal(b["extra_allowance"]) == 0
    assert Decimal(b["cap_total"]) == 10
    assert b["warning_fraction"] == 0.8
    assert b["period_start"].endswith(("Z", "+00:00"))


@pytest.mark.parametrize(
    ("costs", "state"),
    [
        (["7.99"], "ok"),
        (["8.00"], "warned"),
        (["7.00", "1.00"], "warned"),
        (["9.99"], "warned"),
        (["10.00"], "paused"),
        (["12.50"], "paused"),
    ],
)
def test_state_boundaries(client, db_session, costs, state) -> None:
    agent_id = create_agent(client)
    for cost in costs:
        record_run_cost(db_session, agent_id, cost)

    assert budget(client, agent_id)["state"] == state


def test_state_moves_as_spend_grows(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "7.99")
    assert budget(client, agent_id)["state"] == "ok"
    record_run_cost(db_session, agent_id, "0.01")
    assert budget(client, agent_id)["state"] == "warned"
    record_run_cost(db_session, agent_id, "2.00")
    assert budget(client, agent_id)["state"] == "paused"


def test_other_agents_runs_do_not_count(client, db_session) -> None:
    mine = create_agent(client)
    other = create_agent(client, slug="other-agent", name="Other")
    record_run_cost(db_session, other, "50.00")
    record_run_cost(db_session, mine, "1.00")

    b = budget(client, mine)

    assert Decimal(b["spent"]) == 1
    assert b["state"] == "ok"


def test_runs_before_current_period_do_not_count(client, db_session) -> None:
    agent_id = create_agent(client)
    now = dt.datetime.now(dt.UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    record_run_cost(db_session, agent_id, "50.00", created_at=month_start - dt.timedelta(days=1))
    record_run_cost(db_session, agent_id, "2.00")

    b = budget(client, agent_id)

    assert Decimal(b["spent"]) == 2
    assert b["state"] == "ok"


def test_custom_warning_fraction_is_respected(client, db_session) -> None:
    agent_id = create_agent(client, warning_fraction=0.5)
    record_run_cost(db_session, agent_id, "4.99")
    assert budget(client, agent_id)["state"] == "ok"
    record_run_cost(db_session, agent_id, "0.01")

    b = budget(client, agent_id)

    assert b["state"] == "warned"
    assert b["warning_fraction"] == 0.5


def test_decimal_sum_has_no_float_drift(client, db_session) -> None:
    agent_id = create_agent(client)
    for cost in ("0.1", "0.2", "0.3"):
        record_run_cost(db_session, agent_id, cost)

    assert budget(client, agent_id)["spent"] == "0.600000"


def test_cap_follows_the_spec(client) -> None:
    agent_id = create_agent(client)
    assert Decimal(budget(client, agent_id)["cap"]) == 10
    new_spec = spec_yaml("tax-helper", "Tax Helper", {"monthly_cap": 40.0})
    r = client.post(
        f"/v1/agents/{agent_id}/versions", json={"spec_yaml": new_spec}, headers=BUILDER
    )
    assert r.status_code == 201

    assert Decimal(budget(client, agent_id)["cap"]) == 40


def test_read_permissions(client) -> None:
    agent_id = create_agent(client)
    path = f"/v1/agents/{agent_id}/budget"

    assert client.get(path, headers=BUILDER).status_code == 200
    assert client.get(path, headers=ADMIN).status_code == 200
    for headers in (BUILDER_2, END_USER):
        r = client.get(path, headers=headers)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"
    assert client.get(path).status_code == 401


def test_read_unknown_agent_is_404(client) -> None:
    r = client.get("/v1/agents/agt_nope/budget", headers=ADMIN)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"


def test_approve_unpauses_paused_agent(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "10.00")
    assert budget(client, agent_id)["state"] == "paused"

    r = approve(client, agent_id)

    assert r.status_code == 200
    b = r.json()
    assert Decimal(b["extra_allowance"]) == 10
    assert Decimal(b["cap_total"]) == 20
    assert b["state"] == "ok"
    assert budget(client, agent_id)["state"] == "ok"


def test_approve_can_land_in_warned(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "16.00")

    assert approve(client, agent_id).json()["state"] == "warned"


def test_approve_with_explicit_amount(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "10.00")

    b = approve(client, agent_id, {"amount": "2.50"}).json()

    assert Decimal(b["extra_allowance"]) == Decimal("2.5")
    assert Decimal(b["cap_total"]) == Decimal("12.5")
    assert b["state"] == "warned"


def test_approvals_accumulate(client) -> None:
    agent_id = create_agent(client)
    approve(client, agent_id, {"amount": "1.00"})

    b = approve(client, agent_id, {"amount": "2.00"}).json()

    assert Decimal(b["extra_allowance"]) == 3


@pytest.mark.parametrize("amount", ["0", "-5", 0, -1])
def test_approve_rejects_non_positive_amount(client, amount) -> None:
    agent_id = create_agent(client)

    assert approve(client, agent_id, {"amount": amount}).status_code == 422


def test_approve_is_admin_only(client) -> None:
    agent_id = create_agent(client)
    for headers in (BUILDER, END_USER):
        r = approve(client, agent_id, headers=headers)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"
    assert Decimal(budget(client, agent_id)["extra_allowance"]) == 0


def test_approve_unknown_agent_is_404(client) -> None:
    r = approve(client, "agt_nope")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"


def test_spend_after_approval_pauses_again(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "10.00")
    approve(client, agent_id)
    record_run_cost(db_session, agent_id, "10.00")

    assert budget(client, agent_id)["state"] == "paused"


def test_queue_lists_paused_agent_only(client, db_session) -> None:
    paused = create_agent(client, slug="paused-one", name="Paused One")
    warned = create_agent(client, slug="warned-one", name="Warned One")
    create_agent(client, slug="ok-one", name="Ok One")
    record_run_cost(db_session, paused, "11.00")
    record_run_cost(db_session, warned, "9.00")

    items = queue_items(client)

    assert len(items) == 1
    item = items[0]
    assert item["kind"] == "budget_pause"
    assert item["agent_id"] == paused
    assert item["agent_name"] == "Paused One"
    assert Decimal(item["spent"]) == 11
    assert Decimal(item["cap"]) == 10
    assert Decimal(item["extra_allowance"]) == 0
    assert Decimal(item["cap_total"]) == 10
    assert item["since"]


def test_queue_item_disappears_after_approval(client, db_session) -> None:
    agent_id = create_agent(client)
    record_run_cost(db_session, agent_id, "10.00")
    assert len(queue_items(client)) == 1

    approve(client, agent_id)

    assert queue_items(client) == []


def test_queue_orders_by_since(client, db_session) -> None:
    first = create_agent(client, slug="aaa", name="Aaa")
    second = create_agent(client, slug="bbb", name="Bbb")
    record_run_cost(db_session, second, "10.00")
    budget(client, second)
    record_run_cost(db_session, first, "10.00")

    assert [i["agent_id"] for i in queue_items(client)] == [second, first]


def test_empty_queue(client) -> None:
    r = client.get("/v1/admin/queue", headers=ADMIN)

    assert r.status_code == 200
    assert r.json() == {"items": []}


@pytest.mark.parametrize("path", ["/v1/admin/queue", "/v1/admin/budgets"])
def test_admin_reads_forbidden_for_others(client, path) -> None:
    for headers in (BUILDER, END_USER):
        r = client.get(path, headers=headers)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"


def test_admin_budgets_lists_all_agents(client, db_session) -> None:
    a = create_agent(client, slug="alpha", name="Alpha")
    b = create_agent(client, slug="beta", name="Beta")
    record_run_cost(db_session, b, "10.00")

    r = client.get("/v1/admin/budgets", headers=ADMIN)

    assert r.status_code == 200
    items = r.json()["items"]
    assert [(i["agent_id"], i["state"]) for i in items] == [(a, "ok"), (b, "paused")]
