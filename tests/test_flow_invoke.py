"""Invoke flow (ticket #20): a caller runs an agent's live version with one
non-streaming call and gets back JSON once the run stops. The run goes
through the same runtime as chat, on a fresh conversation each time.

Every model call is the scripted fake model behind the real gateway; every
tool runs on the fake MCP server through the connector layer.
"""

import json
from collections.abc import Iterator
from decimal import Decimal

import pytest
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import agent_runtime, checkpointer, connectors, gateway, seams
from hack_tx_2026.fake_model import ScriptedModel, reply, tool_call

ADMIN = {"X-User-Id": "usr_admin"}
BUILDER = {"X-User-Id": "usr_builder"}
END_USER = {"X-User-Id": "usr_end_user"}

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


def deploy_agent(client, db_session, guardrails: dict | None) -> str:
    """A deployed agent owned by usr_builder, granted the fake MCP server.
    `guardrails=None` keeps the spec's default guardrails."""
    spec: dict = {
        "spec_version": 1,
        "name": "Invoke Agent",
        "slug": "invoke-agent",
        "description": "An agent for invoke tests",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Answer from the lookup tool.",
        "connectors": [{"name": "fake-mcp"}],
        "budget": {"monthly_cap": 10.0},
        "evals": {"min_score": 0.8},
    }
    if guardrails is not None:
        spec["guardrails"] = guardrails
    fake_mcp = connectors.seed_fake_mcp_connector(db_session)
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER)
    assert r.status_code == 201, r.text
    created = r.json()["id"]
    g = client.post(
        f"/v1/connectors/{fake_mcp.id}/grants", json={"agent_id": created}, headers=ADMIN
    )
    assert g.status_code in (200, 201), g.text
    d = client.post(f"/v1/agents/{created}/versions/1/deploy", headers=BUILDER)
    assert d.status_code == 200, d.text
    return created


@pytest.fixture
def agent_id(client, db_session, runtime_db) -> str:
    # These tests are not about the output guard (see test_flow_guard.py).
    return deploy_agent(
        client, db_session, guardrails={"require_citation": False, "strip_secrets": False}
    )


@pytest.fixture
def guarded_agent_id(client, db_session, runtime_db) -> str:
    """An agent with the default guardrails: citations required."""
    return deploy_agent(client, db_session, guardrails=None)


def invoke(client, agent_id: str, text: str, headers=END_USER) -> dict:
    r = client.post(f"/v1/agents/{agent_id}/invoke", json={"text": text}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_an_invoke_returns_the_final_answer_once_the_run_completes(
    client, fake_model, agent_id
) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was not found [1]"),
    )

    body = invoke(client, agent_id, "What was revenue?")

    assert body["run_id"].startswith("run_")
    assert body == {
        "run_id": body["run_id"],
        "status": "completed",
        "message": "Revenue was not found [1]",
        "guard_notes": [],
        "approval": None,
        "error": None,
    }


def test_an_invoke_returns_the_guarded_text_and_the_guard_notes(
    client, fake_model, guarded_agent_id
) -> None:
    fake_model.script(reply("Revenue was 5 million."))

    body = invoke(client, guarded_agent_id, "Revenue?")

    assert body["status"] == "completed"
    assert body["message"]
    assert "5 million" not in body["message"]
    [note] = body["guard_notes"]
    assert "citation" in note.lower()


def test_a_model_failure_returns_failed_with_the_error(client, fake_model, agent_id) -> None:
    fake_model.script(RuntimeError("provider is down"))

    body = invoke(client, agent_id, "Hello?")

    assert body["status"] == "failed"
    assert body["message"] is None
    assert body["approval"] is None
    assert body["error"]["code"] == "model_error"
    assert body["error"]["message"]
    detail = client.get(f"/v1/runs/{body['run_id']}", headers=ADMIN).json()
    assert detail["run"]["status"] == "failed"
    assert detail["run"]["entry_point"] == "api"


def test_the_invoke_run_is_recorded_and_metered_like_a_chat_run(
    client, fake_model, agent_id
) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})], cost=Decimal("0.10")),
        reply("Done", cost=Decimal("0.25")),
    )

    run_id = invoke(client, agent_id, "What was revenue?")["run_id"]

    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["run"]["entry_point"] == "api"
    assert detail["run"]["status"] == "completed"
    assert detail["run"]["user_id"] == "usr_end_user"
    assert detail["run"]["duration_ms"] is not None
    assert [(s["kind"], s["name"]) for s in detail["steps"]] == [
        ("model", "gemini/gemini-3.8-flash"),
        ("tool", "lookup"),
        ("model", "gemini/gemini-3.8-flash"),
        ("guard", "output_guard"),
    ]
    assert Decimal(detail["run"]["cost_total"]) == Decimal("0.35")
    spend = client.get(f"/v1/agents/{agent_id}/budget", headers=BUILDER).json()
    assert Decimal(spend["spent"]) == Decimal("0.35")


def test_each_invoke_starts_a_fresh_conversation(client, fake_model, agent_id) -> None:
    fake_model.script(reply("About revenue."), reply("About costs."))
    invoke(client, agent_id, "Tell me about revenue")

    invoke(client, agent_id, "Tell me about costs")

    assert fake_model.requests[-1].messages == [
        {"role": "system", "content": "Answer from the lookup tool."},
        {"role": "user", "content": "Tell me about costs"},
    ]


def test_invoking_an_unknown_agent_is_404(client, fake_model, runtime_db) -> None:
    r = client.post("/v1/agents/agt_nope/invoke", json={"text": "Hi"}, headers=END_USER)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"
    assert fake_model.requests == []


def test_invoking_an_agent_with_no_live_version_is_409(client, fake_model, runtime_db) -> None:
    spec = {
        "spec_version": 1,
        "name": "Draft Agent",
        "slug": "draft-agent",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Be helpful.",
        "budget": {"monthly_cap": 10.0},
        "evals": {"min_score": 0.8},
    }
    created = client.post(
        "/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER
    ).json()

    r = client.post(f"/v1/agents/{created['id']}/invoke", json={"text": "Hi"}, headers=END_USER)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_live_version"
    assert fake_model.requests == []


def test_an_empty_invoke_is_rejected(client, fake_model, agent_id) -> None:
    r = client.post(f"/v1/agents/{agent_id}/invoke", json={"text": ""}, headers=END_USER)

    assert r.status_code == 422
    assert fake_model.requests == []


# --- Approvals on an invoke ---

NOTE = {"text": "Revenue was $12M"}


def test_an_invoke_that_asks_for_approval_returns_the_approval(
    client, fake_model, agent_id
) -> None:
    fake_model.script(reply(tool_calls=[tool_call("note", NOTE, id="call_note")]))

    body = invoke(client, agent_id, "Save a note about revenue")

    assert body["status"] == "awaiting_approval"
    assert body["message"] is None
    assert body["error"] is None
    assert body["approval"]["approval_id"].startswith("apr_")
    assert body["approval"]["tool_name"] == "note"
    assert body["approval"]["tool_input"] == NOTE


def test_deciding_an_invokes_approval_resumes_the_run(client, fake_model, agent_id) -> None:
    fake_model.script(reply(tool_calls=[tool_call("note", NOTE, id="call_note")]))
    asked = invoke(client, agent_id, "Save a note about revenue")
    fake_model.script(reply("Saved the note."))

    with client.stream(
        "POST",
        f"/v1/approvals/{asked['approval']['approval_id']}/decision",
        json={"decision": "approve"},
        headers=END_USER,
    ) as r:
        assert r.status_code == 200, r.read()
        body = "".join(r.iter_text())

    events = [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]
    assert events[0] == {"type": "run_started", "run_id": asked["run_id"]}
    assert events[-2] == {"type": "message_complete", "text": "Saved the note."}
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    detail = client.get(f"/v1/runs/{asked['run_id']}", headers=ADMIN).json()
    assert detail["run"]["status"] == "completed"
    assert detail["run"]["entry_point"] == "api"
