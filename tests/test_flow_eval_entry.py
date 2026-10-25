"""Eval entry point (ticket #26): deploying a version runs its eval cases
through the same runtime as chat, as "eval" runs, with every side-effect tool
rejected automatically and the guarded answer scored by the gate.

Every model call is the scripted fake model behind the real gateway; every
tool runs on the fake MCP server through the connector layer. Nothing fakes
`seams.run_agent`.
"""

from collections.abc import Iterator
from decimal import Decimal

import pytest
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import (
    agent_runtime,
    checkpointer,
    connectors,
    eval_entry,
    fake_mcp,
    gateway,
    seams,
)
from hack_tx_2026.fake_model import ScriptedModel, reply, tool_call

ADMIN = {"X-User-Id": "usr_admin"}
BUILDER = {"X-User-Id": "usr_builder"}

# LangGraph's tables, created by PostgresSaver.setup() rather than Base.metadata.
CHECKPOINT_TABLES = [
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
    "checkpoint_migrations",
]


@pytest.fixture
def runtime_db(test_engine, client, monkeypatch) -> Iterator[None]:
    """Points the runtime, the seams and run memory at the test database.
    Drops the checkpoint tables afterwards, so every test starts clean."""
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(seams, "SessionLocal", factory)
    monkeypatch.setattr(agent_runtime, "SessionLocal", factory)
    monkeypatch.setattr(eval_entry, "SessionLocal", factory)
    saver = checkpointer.open_checkpointer(test_engine.url)
    checkpointer.set_checkpointer(saver)
    yield
    checkpointer.set_checkpointer(None)
    saver.close()
    with test_engine.begin() as conn:
        for table in CHECKPOINT_TABLES:
            conn.execute(text(f'DROP TABLE IF EXISTS "{table}"'))


@pytest.fixture
def fake_model(test_engine, runtime_db) -> Iterator[ScriptedModel]:
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    model = ScriptedModel()
    gateway.set_gateway(gateway.ModelGateway(model, session_factory=factory, sleep=lambda _: None))
    yield model
    gateway.set_gateway(None)


def create_agent(client, db_session, guardrails: dict | None = None) -> str:
    """A draft agent owned by usr_builder, granted the fake MCP server.
    `guardrails=None` keeps the spec's default guardrails (citations required)."""
    spec: dict = {
        "spec_version": 1,
        "name": "Eval Agent",
        "slug": "eval-agent",
        "description": "An agent for eval entry tests",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Answer from the lookup tool.",
        "connectors": [{"name": "fake-mcp"}],
        "budget": {"monthly_cap": 10.0},
        "evals": {"min_score": 1.0},
    }
    if guardrails is not None:
        spec["guardrails"] = guardrails
    server = connectors.seed_fake_mcp_connector(db_session)
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER)
    assert r.status_code == 201, r.text
    created = r.json()["id"]
    g = client.post(f"/v1/connectors/{server.id}/grants", json={"agent_id": created}, headers=ADMIN)
    assert g.status_code in (200, 201), g.text
    return created


@pytest.fixture
def agent_id(client, db_session, runtime_db) -> str:
    return create_agent(client, db_session)


def add_case(client, agent_id: str, question: str, **fields) -> None:
    r = client.post(
        f"/v1/agents/{agent_id}/eval-cases", json={"question": question, **fields}, headers=BUILDER
    )
    assert r.status_code == 201, r.text


def deploy(client, agent_id: str) -> dict:
    r = client.post(f"/v1/agents/{agent_id}/versions/1/deploy", headers=BUILDER)
    assert r.status_code == 200, r.text
    return r.json()


def eval_runs(client, agent_id: str) -> list[dict]:
    r = client.get("/v1/runs", params={"agent_id": agent_id}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return [run for run in r.json()["items"] if run["entry_point"] == "eval"]


def run_detail(client, run_id: str) -> dict:
    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_deploy_runs_each_case_as_a_recorded_metered_eval_run(
    client, fake_model, agent_id
) -> None:
    add_case(client, agent_id, "What was revenue?", expected_strings=["12M"])
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})], cost=Decimal("0.10")),
        reply("Revenue was $12M [1]", cost=Decimal("0.25")),
    )

    body = deploy(client, agent_id)

    assert body["live_version_number"] == 1
    (case,) = body["eval_report"]["per_case_results"]
    assert case["passed"] is True
    assert case["answer"] == "Revenue was $12M [1]"
    (run,) = eval_runs(client, agent_id)
    assert run["user_id"] == "usr_builder"
    detail = run_detail(client, run["id"])
    assert detail["run"]["status"] == "completed"
    assert Decimal(detail["run"]["cost_total"]) == Decimal("0.35")
    assert [s["kind"] for s in detail["steps"]] == ["model", "tool", "model", "guard"]


def test_a_side_effect_call_is_rejected_without_human_input_and_never_runs(
    client, fake_model, agent_id
) -> None:
    add_case(client, agent_id, "Save a note about revenue", expected_strings=["not saved"])
    fake_model.script(
        reply(tool_calls=[tool_call("note", {"text": "Revenue was $12M"}, id="call_note")]),
        reply("The note was not saved [1]"),
    )
    notes_before = list(fake_mcp._notes)

    body = deploy(client, agent_id)

    assert fake_mcp._notes == notes_before
    (case,) = body["eval_report"]["per_case_results"]
    assert case["passed"] is True
    assert case["answer"] == "The note was not saved [1]"
    declined = fake_model.requests[-1].messages[-1]
    assert declined["role"] == "tool" and declined["tool_call_id"] == "call_note"
    assert "declined" in declined["content"]
    (run,) = eval_runs(client, agent_id)
    detail = run_detail(client, run["id"])
    assert detail["run"]["status"] == "completed"
    assert [s["kind"] for s in detail["steps"]] == ["model", "approval", "model", "guard"]
    decision = detail["steps"][1]["approval"]
    assert decision["status"] == "rejected"
    assert decision["decided_by"] == "usr_builder"
    assert decision["decided_at"] is not None


def test_every_side_effect_call_in_a_run_is_rejected(client, fake_model, agent_id) -> None:
    add_case(client, agent_id, "Save two notes", expected_strings=["neither"])
    fake_model.script(
        reply(
            tool_calls=[
                tool_call("note", {"text": "one"}, id="call_1"),
                tool_call("note", {"text": "two"}, id="call_2"),
            ]
        ),
        reply(tool_calls=[tool_call("note", {"text": "three"}, id="call_3")]),
        reply("I saved neither note [1]"),
    )
    notes_before = list(fake_mcp._notes)

    body = deploy(client, agent_id)

    assert fake_mcp._notes == notes_before
    assert body["eval_report"]["per_case_results"][0]["passed"] is True
    (run,) = eval_runs(client, agent_id)
    steps = run_detail(client, run["id"])["steps"]
    approvals = [s["approval"] for s in steps if s["kind"] == "approval"]
    assert [a["status"] for a in approvals] == ["rejected"] * 3
    assert "tool" not in [s["kind"] for s in steps]


def test_a_model_that_keeps_retrying_a_side_effect_fails_its_case(
    client, fake_model, agent_id
) -> None:
    add_case(client, agent_id, "Save a note", expected_strings=["saved"])
    fake_model.script(
        *[
            reply(tool_calls=[tool_call("note", {"text": "again"}, id=f"call_{i}")])
            for i in range(eval_entry.MAX_REJECTIONS + 1)
        ]
    )
    notes_before = list(fake_mcp._notes)

    body = deploy(client, agent_id)

    assert fake_mcp._notes == notes_before
    (case,) = body["eval_report"]["per_case_results"]
    assert case["passed"] is False
    assert "failed" in case["error"]
    (run,) = eval_runs(client, agent_id)
    assert run["status"] == "failed"
    steps = run_detail(client, run["id"])["steps"]
    approvals = [s["approval"] for s in steps if s["kind"] == "approval"]
    assert len(approvals) == eval_entry.MAX_REJECTIONS + 1
    assert {a["status"] for a in approvals} == {"rejected"}


def test_the_gate_scores_the_guarded_answer(client, fake_model, db_session, runtime_db) -> None:
    agent_id = create_agent(client, db_session)  # default guardrails: citation required
    add_case(client, agent_id, "Revenue?", expected_strings=["5 million"])
    fake_model.script(reply("Revenue was 5 million."))

    body = deploy(client, agent_id)

    assert body["live_version_number"] is None
    assert body["versions"][0]["status"] == "blocked"
    (case,) = body["eval_report"]["per_case_results"]
    assert case["passed"] is False
    assert "5 million" not in case["answer"]
    assert case["missing_strings"] == ["5 million"]


def test_a_cited_answer_passes_a_citation_required_case(client, fake_model, agent_id) -> None:
    add_case(client, agent_id, "Revenue?", citation_required=True)
    fake_model.script(reply("Revenue was $12M (source: 10-Q)"))

    body = deploy(client, agent_id)

    (case,) = body["eval_report"]["per_case_results"]
    assert case["citation_ok"] is True
    assert case["passed"] is True
    assert body["live_version_number"] == 1


def test_a_failed_eval_run_fails_its_case(client, fake_model, agent_id) -> None:
    add_case(client, agent_id, "Revenue?", expected_strings=["12M"])
    fake_model.script(RuntimeError("scripted outage"))

    body = deploy(client, agent_id)

    (case,) = body["eval_report"]["per_case_results"]
    assert case["passed"] is False
    assert "failed" in case["error"]
    (run,) = eval_runs(client, agent_id)
    assert run["status"] == "failed"
