"""Flag flow (ticket #30): an end user flags an answer. That files a ticket
with the question and the flagged answer, and streams a re-check run of the
same agent version on a fresh conversation. Both run logs are reachable from
the ticket.

Every model call is the scripted fake model behind the real gateway.
"""

import json
from collections.abc import Iterator

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

SPEC = {
    "spec_version": 1,
    "name": "Chat Agent",
    "slug": "chat-agent",
    "description": "An agent for chat tests",
    "model": "gemini/gemini-3.8-flash",
    "instructions": "Answer from the lookup tool.",
    "connectors": [{"name": "fake-mcp"}],
    "budget": {"monthly_cap": 10.0},
    "evals": {"min_score": 0.8},
}


@pytest.fixture
def runtime_db(test_engine, client, monkeypatch) -> Iterator[None]:
    """Points the runtime, the seams and thread memory at the test database.
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
def install_model(test_engine, runtime_db) -> Iterator:
    factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)

    def install(model_client: gateway.ModelClient) -> None:
        gateway.set_gateway(
            gateway.ModelGateway(model_client, session_factory=factory, sleep=lambda _: None)
        )

    yield install
    gateway.set_gateway(None)


@pytest.fixture
def fake_model(install_model) -> ScriptedModel:
    model = ScriptedModel()
    install_model(model)
    return model


@pytest.fixture
def agent_id(client, db_session, runtime_db) -> str:
    """A deployed agent owned by usr_builder, granted the fake MCP server."""
    fake_mcp = connectors.seed_fake_mcp_connector(db_session)
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(SPEC)}, headers=BUILDER)
    assert r.status_code == 201, r.text
    created = r.json()["id"]
    g = client.post(
        f"/v1/connectors/{fake_mcp.id}/grants", json={"agent_id": created}, headers=ADMIN
    )
    assert g.status_code in (200, 201), g.text
    d = client.post(f"/v1/agents/{created}/versions/1/deploy", headers=BUILDER)
    assert d.status_code == 200, d.text
    return created


def new_thread(client, agent_id: str, headers=END_USER) -> dict:
    r = client.post(f"/v1/agents/{agent_id}/threads", headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def send(client, thread_id: str, text: str, headers=END_USER) -> list[dict]:
    """Posts a message and returns the stream's events, in order."""
    with client.stream(
        "POST", f"/v1/threads/{thread_id}/messages", json={"text": text}, headers=headers
    ) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    return [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def events_of(body: str) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def flag(client, run_id: str, headers=END_USER) -> list[dict]:
    """Flags a run's answer and returns the re-check stream's events."""
    with client.stream("POST", f"/v1/runs/{run_id}/flag", json={}, headers=headers) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    return events_of(body)


def flagged_run(client, fake_model, agent_id) -> tuple[dict, str]:
    """A thread with one answered question; returns the thread and its run id."""
    fake_model.script(reply("Revenue was 10."))
    thread = new_thread(client, agent_id)
    run_id = send(client, thread["id"], "What was revenue?")[0]["run_id"]
    return thread, run_id


# --- Re-check stream ---


def test_flagging_streams_a_recheck_run_of_the_question(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was not found [1]"),
    )

    events = flag(client, run_id)

    assert events[0]["type"] == "run_started"
    recheck_id = events[0]["run_id"]
    assert recheck_id.startswith("run_") and recheck_id != run_id
    assert [e["type"] for e in events if e["type"] != "token"] == [
        "run_started",
        "tool_call",
        "tool_result",
        "message_complete",
        "run_finished",
    ]
    assert events[-2] == {"type": "message_complete", "text": "Revenue was not found [1]"}
    assert events[-1] == {"type": "run_finished", "status": "completed"}


def test_the_recheck_sees_only_the_flagged_question(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Hello."), reply("Revenue was 10."))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "Hi there")
    run_id = send(client, thread["id"], "What was revenue?")[0]["run_id"]
    fake_model.script(reply("Revenue was 12."))

    flag(client, run_id)

    assert fake_model.requests[-1].messages == [
        {"role": "system", "content": "Answer from the lookup tool."},
        {"role": "user", "content": "What was revenue?"},
    ]


def test_the_recheck_is_recorded_as_a_recheck_run(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(reply("Revenue was 12."))

    recheck_id = flag(client, run_id)[0]["run_id"]

    recheck = client.get(f"/v1/runs/{recheck_id}", headers=ADMIN).json()
    assert recheck["run"]["entry_point"] == "recheck"
    assert recheck["run"]["status"] == "completed"
    assert recheck["run"]["user_id"] == "usr_end_user"
    assert recheck["run"]["agent_id"] == agent_id
    assert [s["kind"] for s in recheck["steps"]] == ["model"]


def test_the_recheck_runs_the_version_that_gave_the_answer(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    spec = {**SPEC, "instructions": "New instructions."}
    r = client.post(
        f"/v1/agents/{agent_id}/versions",
        json={"spec_yaml": yaml.safe_dump(spec)},
        headers=BUILDER,
    )
    assert r.status_code == 201, r.text
    d = client.post(f"/v1/agents/{agent_id}/versions/2/deploy", headers=BUILDER)
    assert d.status_code == 200, d.text
    fake_model.script(reply("Revenue was 12."))

    flag(client, run_id)

    assert fake_model.requests[-1].messages[0] == {
        "role": "system",
        "content": "Answer from the lookup tool.",
    }


def test_the_recheck_leaves_the_users_thread_alone(client, fake_model, agent_id) -> None:
    thread, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(reply("Revenue was 12."))

    flag(client, run_id)

    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert [(m["role"], m["text"]) for m in messages] == [
        ("user", "What was revenue?"),
        ("assistant", "Revenue was 10."),
    ]
    threads = client.get(f"/v1/agents/{agent_id}/threads", headers=END_USER).json()["items"]
    assert [t["id"] for t in threads] == [thread["id"]]


# --- The ticket ---


def test_flagging_files_a_ticket_that_reaches_both_run_logs(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(reply("Revenue was 12."))

    recheck_id = flag(client, run_id)[0]["run_id"]

    [item] = client.get("/v1/tickets", headers=BUILDER).json()["items"]
    ticket = client.get(f"/v1/tickets/{item['id']}", headers=BUILDER).json()
    assert ticket["question"] == "What was revenue?"
    assert ticket["answer"] == "Revenue was 10."
    assert ticket["status"] == "open"
    assert ticket["created_by"] == "usr_end_user"
    assert ticket["run_id"] == run_id
    assert ticket["recheck_run_id"] == recheck_id
    for linked in (ticket["run_id"], ticket["recheck_run_id"]):
        r = client.get(f"/v1/runs/{linked}", headers=BUILDER)
        assert r.status_code == 200, r.text
        assert r.json()["steps"]


def test_a_recheck_answer_can_be_flagged_too(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(reply("Revenue was 12."), reply("Revenue was 14."))
    recheck_id = flag(client, run_id)[0]["run_id"]

    events = flag(client, recheck_id)

    assert events[-1] == {"type": "run_finished", "status": "completed"}
    items = client.get("/v1/tickets", headers=BUILDER).json()["items"]
    [second] = [t for t in items if t["run_id"] == recheck_id]
    detail = client.get(f"/v1/tickets/{second['id']}", headers=BUILDER).json()
    assert (detail["question"], detail["answer"]) == ("What was revenue?", "Revenue was 12.")


# --- run_id on saved messages ---


def test_saved_answers_carry_their_run_id_for_flagging(client, fake_model, agent_id) -> None:
    thread, run_id = flagged_run(client, fake_model, agent_id)

    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()

    assert [(m["role"], m["run_id"]) for m in messages] == [("user", None), ("assistant", run_id)]


# --- Preconditions, checked before the stream opens ---


def test_only_the_runs_own_user_can_flag_it(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    calls = len(fake_model.requests)

    r = client.post(f"/v1/runs/{run_id}/flag", json={}, headers=BUILDER)

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"
    assert len(fake_model.requests) == calls
    assert client.get("/v1/tickets", headers=ADMIN).json()["items"] == []


def test_an_unknown_run_cannot_be_flagged(client, runtime_db) -> None:
    r = client.post("/v1/runs/run_nope/flag", json={}, headers=END_USER)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "run_not_found"


def test_flagging_the_same_run_again_is_409(client, fake_model, agent_id) -> None:
    _, run_id = flagged_run(client, fake_model, agent_id)
    fake_model.script(reply("Revenue was 12."))
    flag(client, run_id)
    calls = len(fake_model.requests)

    r = client.post(f"/v1/runs/{run_id}/flag", json={}, headers=END_USER)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_flagged"
    assert len(fake_model.requests) == calls
    assert len(client.get("/v1/tickets", headers=ADMIN).json()["items"]) == 1


def test_a_run_without_an_answer_cannot_be_flagged(client, fake_model, agent_id) -> None:
    fake_model.script(RuntimeError("provider is down"))
    thread = new_thread(client, agent_id)
    run_id = send(client, thread["id"], "Hello?")[0]["run_id"]

    r = client.post(f"/v1/runs/{run_id}/flag", json={}, headers=END_USER)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_answer"
    assert client.get("/v1/tickets", headers=ADMIN).json()["items"] == []
