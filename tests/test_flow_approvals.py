"""Chat with an approval (tickets #24 and #42): when the model calls a
side-effect tool the run records an approval, pauses and ends the stream.
Deciding it (POST /v1/approvals/{id}/decision) streams the same run resumed:
approve runs the tool and records it, reject tells the model it was declined.

Every model call is the scripted fake model behind the real gateway; the
side-effect tool is the fake MCP server's `note`.
"""

import json
from collections.abc import Iterator

import pytest
import yaml
from sqlalchemy import select, text
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import agent_runtime, checkpointer, connectors, gateway, seams
from hack_tx_2026.db.orm import RunStep
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
    spec = {
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


def decide(client, approval_id: str, decision: str, headers=END_USER) -> list[dict]:
    """Decides an approval and returns the resumed run's events, in order."""
    with client.stream(
        "POST",
        f"/v1/approvals/{approval_id}/decision",
        json={"decision": decision},
        headers=headers,
    ) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    return events_of(body)


NOTE = {"text": "Revenue was $12M"}


def ask_for_a_note(client, fake_model, agent_id, *, text: str = "") -> tuple[dict, list[dict]]:
    """Starts a run whose model calls the side-effect tool; returns the thread
    and the stream's events."""
    fake_model.script(reply(text, tool_calls=[tool_call("note", NOTE, id="call_note")]))
    thread = new_thread(client, agent_id)
    return thread, send(client, thread["id"], "Save a note about revenue")


# --- Asking for approval ---


def test_a_side_effect_call_streams_approval_required_then_awaiting_approval(
    client, fake_model, agent_id
) -> None:
    _, events = ask_for_a_note(client, fake_model, agent_id)

    assert [e["type"] for e in events] == ["run_started", "approval_required", "run_finished"]
    approval = events[1]
    assert approval["approval_id"].startswith("apr_")
    assert approval["tool_name"] == "note"
    assert approval["tool_input"] == NOTE
    assert events[2] == {"type": "run_finished", "status": "awaiting_approval"}


def test_text_before_the_call_is_sent_as_a_message_before_approval_required(
    client, fake_model, agent_id
) -> None:
    thread, events = ask_for_a_note(
        client, fake_model, agent_id, text="I'd like to save that as a note."
    )

    types = [e["type"] for e in events if e["type"] != "token"]
    assert types == ["run_started", "message_complete", "approval_required", "run_finished"]
    assert events[-3] == {"type": "message_complete", "text": "I'd like to save that as a note."}
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert [(m["role"], m["text"]) for m in messages] == [
        ("user", "Save a note about revenue"),
        ("assistant", "I'd like to save that as a note."),
    ]


def test_the_model_is_offered_the_side_effect_tool(client, fake_model, agent_id) -> None:
    ask_for_a_note(client, fake_model, agent_id)

    [request] = fake_model.requests
    assert sorted(t["function"]["name"] for t in request.tools) == ["lookup", "note"]


def test_a_pending_approval_is_recorded_on_the_run_and_not_run(
    client, fake_model, agent_id, db_session
) -> None:
    _, events = ask_for_a_note(client, fake_model, agent_id)
    run_id, approval_id = events[0]["run_id"], events[1]["approval_id"]

    detail = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()

    assert detail["run"]["status"] == "awaiting_approval"
    assert [(s["kind"], s["name"]) for s in detail["steps"]] == [
        ("model", "gemini/gemini-3.8-flash"),
        ("approval", "note"),
    ]
    assert detail["steps"][1]["approval"] == {
        "id": approval_id,
        "tool_name": "note",
        "status": "pending",
        "decided_by": None,
        "decided_by_name": None,
        "decided_at": None,
    }
    # #42: the step names its approval, so run detail never has to guess.
    step = db_session.scalar(select(RunStep).where(RunStep.kind == "approval"))
    assert step is not None and step.input["approval_id"] == approval_id


# --- Approving ---


def test_approving_resumes_the_same_run_runs_the_tool_and_answers(
    client, fake_model, agent_id
) -> None:
    thread, asked = ask_for_a_note(client, fake_model, agent_id)
    run_id, approval_id = asked[0]["run_id"], asked[1]["approval_id"]
    fake_model.script(reply("Saved the note."))

    events = decide(client, approval_id, "approve")

    assert events[0] == {"type": "run_started", "run_id": run_id}
    types = [e["type"] for e in events if e["type"] != "token"]
    assert types == ["run_started", "tool_call", "tool_result", "message_complete", "run_finished"]
    assert events[1] == {"type": "tool_call", "name": "note", "input": NOTE}
    assert events[2]["output"]["status"] == "recorded"
    assert events[-2] == {"type": "message_complete", "text": "Saved the note."}
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    # The model saw the tool's real result for its call.
    last = fake_model.requests[-1].messages[-1]
    assert last["role"] == "tool" and last["tool_call_id"] == "call_note"
    assert json.loads(last["content"])["status"] == "recorded"
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert [(m["role"], m["text"]) for m in messages] == [
        ("user", "Save a note about revenue"),
        ("assistant", "Saved the note."),
    ]


def test_an_approved_run_records_the_tool_step_and_who_decided_when(
    client, fake_model, agent_id
) -> None:
    _, asked = ask_for_a_note(client, fake_model, agent_id)
    run_id, approval_id = asked[0]["run_id"], asked[1]["approval_id"]
    fake_model.script(reply("Saved the note."))

    decide(client, approval_id, "approve")

    detail = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()
    assert detail["run"]["status"] == "completed"
    assert [(s["kind"], s["name"]) for s in detail["steps"]] == [
        ("model", "gemini/gemini-3.8-flash"),
        ("approval", "note"),
        ("tool", "note"),
        ("model", "gemini/gemini-3.8-flash"),
    ]
    decision = detail["steps"][1]["approval"]
    assert decision["id"] == approval_id
    assert decision["status"] == "approved"
    assert decision["decided_by"] == "usr_end_user"
    assert decision["decided_by_name"] == "Eli End User"
    assert decision["decided_at"] is not None
    assert detail["steps"][2]["error"] is None


# --- Rejecting ---


def test_rejecting_tells_the_model_it_was_declined_and_lets_it_answer(
    client, fake_model, agent_id
) -> None:
    thread, asked = ask_for_a_note(client, fake_model, agent_id)
    run_id, approval_id = asked[0]["run_id"], asked[1]["approval_id"]
    fake_model.script(reply("Okay, I didn't save the note."))

    events = decide(client, approval_id, "reject")

    types = [e["type"] for e in events if e["type"] != "token"]
    assert types == ["run_started", "message_complete", "run_finished"]
    assert events[0] == {"type": "run_started", "run_id": run_id}
    assert events[-2] == {"type": "message_complete", "text": "Okay, I didn't save the note."}
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    last = fake_model.requests[-1].messages[-1]
    assert last["role"] == "tool" and last["tool_call_id"] == "call_note"
    assert json.loads(last["content"])["error"] == "declined"
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert messages[-1]["text"] == "Okay, I didn't save the note."


def test_a_rejected_run_records_who_rejected_and_never_runs_the_tool(
    client, fake_model, agent_id
) -> None:
    _, asked = ask_for_a_note(client, fake_model, agent_id)
    run_id, approval_id = asked[0]["run_id"], asked[1]["approval_id"]
    fake_model.script(reply("Okay."))

    decide(client, approval_id, "reject")

    detail = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()
    assert detail["run"]["status"] == "completed"
    assert [s["kind"] for s in detail["steps"]] == ["model", "approval", "model"]
    decision = detail["steps"][1]["approval"]
    assert decision["status"] == "rejected"
    assert decision["decided_by"] == "usr_end_user"
    assert decision["decided_at"] is not None


# --- Who may decide, and when ---


def test_only_the_runs_user_may_decide(client, fake_model, agent_id) -> None:
    _, asked = ask_for_a_note(client, fake_model, agent_id)
    approval_id = asked[1]["approval_id"]

    for headers in (BUILDER, ADMIN):
        r = client.post(
            f"/v1/approvals/{approval_id}/decision", json={"decision": "approve"}, headers=headers
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"
    assert len(fake_model.requests) == 1


def test_an_unknown_approval_is_404(client, runtime_db) -> None:
    r = client.post(
        "/v1/approvals/apr_nope/decision", json={"decision": "approve"}, headers=END_USER
    )

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "approval_not_found"


def test_a_decided_approval_cannot_be_decided_again(client, fake_model, agent_id) -> None:
    _, asked = ask_for_a_note(client, fake_model, agent_id)
    approval_id = asked[1]["approval_id"]
    fake_model.script(reply("Saved."))
    decide(client, approval_id, "approve")

    r = client.post(
        f"/v1/approvals/{approval_id}/decision", json={"decision": "reject"}, headers=END_USER
    )

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "approval_already_decided"
    assert len(fake_model.requests) == 2


def test_a_decision_must_be_approve_or_reject(client, fake_model, agent_id) -> None:
    _, asked = ask_for_a_note(client, fake_model, agent_id)

    r = client.post(
        f"/v1/approvals/{asked[1]['approval_id']}/decision",
        json={"decision": "maybe"},
        headers=END_USER,
    )

    assert r.status_code == 422


def test_a_new_message_while_an_approval_is_pending_is_409(client, fake_model, agent_id) -> None:
    thread, _ = ask_for_a_note(client, fake_model, agent_id)

    r = client.post(
        f"/v1/threads/{thread['id']}/messages", json={"text": "Hello?"}, headers=END_USER
    )

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "approval_pending"
    assert len(fake_model.requests) == 1


def test_after_deciding_the_thread_takes_new_messages(client, fake_model, agent_id) -> None:
    thread, asked = ask_for_a_note(client, fake_model, agent_id)
    fake_model.script(reply("Okay."), reply("Hi again."))
    decide(client, asked[1]["approval_id"], "reject")

    events = send(client, thread["id"], "Hello?")

    assert events[-1] == {"type": "run_finished", "status": "completed"}


# --- Two approvals in one run (#42) ---


def test_each_approval_step_shows_its_own_decision(
    client, fake_model, agent_id, db_session
) -> None:
    fake_model.script(
        reply(
            "Two notes.",
            tool_calls=[
                tool_call("note", {"text": "first"}, id="call_1"),
                tool_call("note", {"text": "second"}, id="call_2"),
            ],
        ),
    )
    thread = new_thread(client, agent_id)
    asked = send(client, thread["id"], "Save two notes")
    run_id, first = asked[0]["run_id"], [e for e in asked if e["type"] == "approval_required"]
    assert [e["tool_input"] for e in first] == [{"text": "first"}]

    resumed = decide(client, first[0]["approval_id"], "approve")
    [second] = [e for e in resumed if e["type"] == "approval_required"]
    assert second["tool_input"] == {"text": "second"}
    assert resumed[0] == {"type": "run_started", "run_id": run_id}
    # The text before the calls was sent once, in the first stream.
    assert "message_complete" not in [e["type"] for e in resumed]
    assert resumed[-1] == {"type": "run_finished", "status": "awaiting_approval"}
    fake_model.script(reply("Saved the first note only."))
    done = decide(client, second["approval_id"], "reject")
    assert done[-1] == {"type": "run_finished", "status": "completed"}

    detail = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()
    assert [s["kind"] for s in detail["steps"]] == [
        "model",
        "approval",
        "tool",
        "approval",
        "model",
    ]
    by_step = [s["approval"] for s in detail["steps"] if s["kind"] == "approval"]
    assert [(a["id"], a["status"]) for a in by_step] == [
        (first[0]["approval_id"], "approved"),
        (second["approval_id"], "rejected"),
    ]
    assert by_step[0]["decided_at"] < by_step[1]["decided_at"]
    steps = db_session.scalars(
        select(RunStep).where(RunStep.kind == "approval").order_by(RunStep.sequence)
    )
    assert [s.input["approval_id"] for s in steps] == [
        first[0]["approval_id"],
        second["approval_id"],
    ]
    # Both tool results reached the model, in call order.
    tool_ids = [m["tool_call_id"] for m in fake_model.requests[-1].messages if m["role"] == "tool"]
    assert tool_ids == ["call_1", "call_2"]
