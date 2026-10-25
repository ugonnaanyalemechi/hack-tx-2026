"""Budget ladder flow (tickets #22, #61, #62): crossing the warning fraction
warns the open chat, reaching the cap pauses every open chat with the agent
before its next model call, and Continue resumes each paused run from its
checkpoint once an admin has approved extra spend.

The scripted fake model reports chosen costs, so the tests cross 80% and 100%
of the agent's $10 cap without spending anything.
"""

import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
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
        "name": "Budget Agent",
        "slug": "budget-agent",
        "description": "An agent for budget tests",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Answer from the lookup tool.",
        "connectors": [{"name": "fake-mcp"}],
        "budget": {"monthly_cap": 10.0},
        "evals": {"min_score": 0.8},
        "guardrails": {"require_citation": False, "strip_secrets": False},
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


def _stream(client, path: str, headers: dict, json_body: dict | None = None) -> list[dict]:
    with client.stream("POST", path, json=json_body, headers=headers) as r:
        assert r.status_code == 200, r.read()
        assert r.headers["content-type"].startswith("text/event-stream")
        body = "".join(r.iter_text())
    return [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def send(client, thread_id: str, text: str, headers=END_USER) -> list[dict]:
    """Posts a message and returns the stream's events, in order."""
    return _stream(client, f"/v1/threads/{thread_id}/messages", headers, {"text": text})


def resume(client, thread_id: str, headers=END_USER) -> list[dict]:
    """Presses Continue on a paused thread and returns the stream's events, in order."""
    return _stream(client, f"/v1/threads/{thread_id}/resume", headers)


def budget(client, agent_id: str) -> dict:
    r = client.get(f"/v1/agents/{agent_id}/budget", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


# --- Warning at 80% ---


def test_the_run_that_crosses_the_warning_fraction_warns_before_run_finished(
    client, fake_model, agent_id
) -> None:
    fake_model.script(reply("Cheap", cost=Decimal("7.00")), reply("Pricey", cost=Decimal("1.50")))
    thread = new_thread(client, agent_id)

    below = send(client, thread["id"], "First question")
    crossing = send(client, thread["id"], "Second question")

    assert "budget_warning" not in types(below)
    assert types(crossing)[-3:] == ["message_complete", "budget_warning", "run_finished"]
    assert crossing[-2] == {"type": "budget_warning", "agent_id": agent_id}
    assert crossing[-1] == {"type": "run_finished", "status": "completed"}
    assert budget(client, agent_id)["state"] == "warned"


def test_runs_after_the_warning_do_not_warn_again(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Pricey", cost=Decimal("8.00")), reply("Again", cost=Decimal("0.50")))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "First question")

    events = send(client, thread["id"], "Second question")

    assert "budget_warning" not in types(events)
    assert events[-1] == {"type": "run_finished", "status": "completed"}


# --- Pause at 100% ---


def run_detail(client, run_id: str) -> dict:
    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def approve_spend(client, agent_id: str) -> None:
    r = client.post(f"/v1/agents/{agent_id}/budget/approve", headers=ADMIN)
    assert r.status_code == 200, r.text


def error_code(r) -> str:
    return r.json()["error"]["code"]


def pause_mid_run(client, fake_model, agent_id: str) -> tuple[dict, list[dict]]:
    """A thread whose run spends the whole cap on a tool turn, then pauses."""
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"}, id="call_1")], cost=Decimal(10))
    )
    thread = new_thread(client, agent_id)
    return thread, send(client, thread["id"], "What was revenue?")


def test_reaching_the_cap_pauses_the_run_before_its_next_model_call(
    client, fake_model, agent_id
) -> None:
    _, events = pause_mid_run(client, fake_model, agent_id)

    assert types(events) == [
        "run_started",
        "tool_call",
        "tool_result",
        "budget_warning",
        "budget_paused",
        "run_finished",
    ]
    assert events[-2] == {"type": "budget_paused", "agent_id": agent_id}
    assert events[-1] == {"type": "run_finished", "status": "paused"}
    assert len(fake_model.requests) == 1
    detail = run_detail(client, events[0]["run_id"])
    assert detail["run"]["status"] == "paused"
    assert [s["kind"] for s in detail["steps"]] == ["model", "tool"]
    assert budget(client, agent_id)["state"] == "paused"


def test_a_paused_chat_keeps_the_question_it_was_answering(client, fake_model, agent_id) -> None:
    thread, _ = pause_mid_run(client, fake_model, agent_id)

    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()

    assert [(m["role"], m["text"]) for m in messages] == [("user", "What was revenue?")]


def test_while_paused_new_messages_and_continue_are_409_budget_paused(
    client, fake_model, agent_id
) -> None:
    thread, _ = pause_mid_run(client, fake_model, agent_id)
    other = new_thread(client, agent_id)

    blocked = [
        client.post(f"/v1/threads/{thread['id']}/resume", headers=END_USER),
        client.post(f"/v1/threads/{thread['id']}/messages", json={"text": "Hi"}, headers=END_USER),
        client.post(f"/v1/threads/{other['id']}/messages", json={"text": "Hi"}, headers=END_USER),
    ]

    for r in blocked:
        assert r.status_code == 409, r.text
        assert error_code(r) == "budget_paused"
    assert len(fake_model.requests) == 1


def test_after_approval_continue_resumes_the_run_from_its_checkpoint(
    client, fake_model, agent_id
) -> None:
    thread, paused = pause_mid_run(client, fake_model, agent_id)
    run_id = paused[0]["run_id"]
    approve_spend(client, agent_id)
    fake_model.script(reply("Revenue was not found [1]", cost=Decimal("0.10")))

    events = resume(client, thread["id"])

    assert events[0] == {"type": "run_started", "run_id": run_id}
    assert types(events)[-2:] == ["message_complete", "run_finished"]
    assert events[-2]["text"] == "Revenue was not found [1]"
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    assert "tool_call" not in types(events)  # the tool ran before the pause
    continued = fake_model.requests[-1].messages
    assert continued[-2]["tool_calls"][0]["id"] == "call_1"
    assert continued[-1]["role"] == "tool"
    assert continued[-1]["tool_call_id"] == "call_1"
    detail = run_detail(client, run_id)
    assert detail["run"]["status"] == "completed"
    assert [s["kind"] for s in detail["steps"]] == ["model", "tool", "model", "guard"]
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert [(m["role"], m["text"]) for m in messages] == [
        ("user", "What was revenue?"),
        ("assistant", "Revenue was not found [1]"),
    ]


def test_after_continue_the_chat_takes_new_messages_again(client, fake_model, agent_id) -> None:
    thread, _ = pause_mid_run(client, fake_model, agent_id)
    approve_spend(client, agent_id)
    fake_model.script(reply("Not found."), reply("You asked about revenue."))
    resume(client, thread["id"])

    events = send(client, thread["id"], "What did I ask?")

    assert events[-1] == {"type": "run_finished", "status": "completed"}
    history = fake_model.requests[-1].messages
    assert [m["role"] for m in history] == [
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
    ]


def test_continue_on_a_chat_that_is_not_paused_is_409(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Hi"))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "Hello")

    r = client.post(f"/v1/threads/{thread['id']}/resume", headers=END_USER)

    assert r.status_code == 409
    assert error_code(r) == "nothing_to_resume"


def test_continue_on_someone_elses_chat_is_403(client, fake_model, agent_id) -> None:
    thread, _ = pause_mid_run(client, fake_model, agent_id)
    approve_spend(client, agent_id)

    r = client.post(f"/v1/threads/{thread['id']}/resume", headers=BUILDER)

    assert r.status_code == 403
    assert error_code(r) == "forbidden"


def test_a_pending_approval_makes_new_messages_and_continue_409_approval_pending(
    client, fake_model, agent_id
) -> None:
    fake_model.script(reply(tool_calls=[tool_call("note", {"text": "remember this"})]))
    thread = new_thread(client, agent_id)
    asked = send(client, thread["id"], "Record a note")
    assert asked[-1] == {"type": "run_finished", "status": "awaiting_approval"}

    blocked = [
        client.post(f"/v1/threads/{thread['id']}/resume", headers=END_USER),
        client.post(f"/v1/threads/{thread['id']}/messages", json={"text": "Hi"}, headers=END_USER),
    ]

    for r in blocked:
        assert r.status_code == 409, r.text
        assert error_code(r) == "approval_pending"


# --- Every open chat pauses ---


class PerThreadModel:
    """Plays each thread its own script, keyed by the thread's first question.
    A thread with a gate holds its first call open until the gate is set, so a
    test can let another chat hit the cap while this one is mid-run."""

    def __init__(self) -> None:
        self.scripts: dict[str, ScriptedModel] = {}
        self.gates: dict[str, threading.Event] = {}
        self.entered: dict[str, threading.Event] = {}

    def script(self, question: str, *items, gated: bool = False) -> None:
        self.scripts.setdefault(question, ScriptedModel()).script(*items)
        if gated:
            self.gates[question] = threading.Event()
            self.entered[question] = threading.Event()

    def release(self, question: str) -> None:
        self.gates[question].set()

    def complete(self, *, model, messages, tools, on_token):
        question = next(m["content"] for m in messages if m["role"] == "user")
        if question in self.entered and not self.entered[question].is_set():
            self.entered[question].set()
            assert self.gates[question].wait(timeout=10)
        return self.scripts[question].complete(
            model=model, messages=messages, tools=tools, on_token=on_token
        )


def test_reaching_the_cap_pauses_every_open_chat_and_each_continues_after_approval(
    client, install_model, agent_id
) -> None:
    model = PerThreadModel()
    install_model(model)
    lookup = [tool_call("lookup", {"query": "revenue"}, id="call_1")]
    model.script(
        "Question A", reply(tool_calls=lookup, cost=Decimal(0)), reply("Answer A"), gated=True
    )
    model.script("Question B", reply(tool_calls=lookup, cost=Decimal(10)), reply("Answer B"))
    chat_a = new_thread(client, agent_id)
    chat_b = new_thread(client, agent_id)

    with ThreadPoolExecutor(max_workers=1) as pool:
        # Chat A is mid-run (its first model call in flight) while chat B hits the cap.
        pending_a = pool.submit(send, client, chat_a["id"], "Question A")
        assert model.entered["Question A"].wait(timeout=10)
        paused_b = send(client, chat_b["id"], "Question B")
        model.release("Question A")
        paused_a = pending_a.result(timeout=10)

    assert "budget_warning" in types(paused_b)  # B's spend crossed 80%, A's didn't
    assert "budget_warning" not in types(paused_a)
    for events in (paused_a, paused_b):
        assert types(events)[-2:] == ["budget_paused", "run_finished"]
        assert events[-1] == {"type": "run_finished", "status": "paused"}
        assert run_detail(client, events[0]["run_id"])["run"]["status"] == "paused"
    for chat in (chat_a, chat_b):
        r = client.post(f"/v1/threads/{chat['id']}/resume", headers=END_USER)
        assert r.status_code == 409
        assert error_code(r) == "budget_paused"

    approve_spend(client, agent_id)

    for chat, paused, answer in ((chat_a, paused_a, "Answer A"), (chat_b, paused_b, "Answer B")):
        events = resume(client, chat["id"])
        assert events[0] == {"type": "run_started", "run_id": paused[0]["run_id"]}
        assert events[-2:] == [
            {"type": "message_complete", "text": answer},
            {"type": "run_finished", "status": "completed"},
        ]
    # One more cap approved: $10 of $20 spent is under the warning line again.
    assert budget(client, agent_id)["state"] == "ok"


def test_an_invoke_at_the_cap_answers_paused_without_calling_the_model(
    client, fake_model, agent_id
) -> None:
    fake_model.script(reply("Spent it all", cost=Decimal(10)))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "Use up the budget")

    r = client.post(f"/v1/agents/{agent_id}/invoke", json={"text": "Hello"}, headers=END_USER)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "paused"
    assert body["message"] is None
    assert body["approval"] is None
    assert body["error"] is None
    assert len(fake_model.requests) == 1
    assert run_detail(client, body["run_id"])["run"]["status"] == "paused"


def test_a_resumed_run_can_stop_again_for_an_approval(client, fake_model, agent_id) -> None:
    thread, paused = pause_mid_run(client, fake_model, agent_id)
    approve_spend(client, agent_id)
    fake_model.script(reply(tool_calls=[tool_call("note", {"text": "remember this"}, id="c2")]))

    events = resume(client, thread["id"])

    assert types(events)[-2:] == ["approval_required", "run_finished"]
    assert events[-1] == {"type": "run_finished", "status": "awaiting_approval"}
    for r in (
        client.post(f"/v1/threads/{thread['id']}/resume", headers=END_USER),
        client.post(f"/v1/threads/{thread['id']}/messages", json={"text": "Hi"}, headers=END_USER),
    ):
        assert r.status_code == 409
        assert error_code(r) == "approval_pending"
    assert run_detail(client, paused[0]["run_id"])["run"]["status"] == "awaiting_approval"


def test_a_budget_pause_after_an_approval_resumes_cleanly(client, fake_model, agent_id) -> None:
    """The run asks for approval, the admin's approval is not enough because the
    cap is hit by the approved run's next model call: it pauses, then continues."""
    fake_model.script(
        reply(tool_calls=[tool_call("note", {"text": "remember this"}, id="call_note")]),
    )
    thread = new_thread(client, agent_id)
    asked = send(client, thread["id"], "Record a note")
    approval_id = next(e["approval_id"] for e in asked if e["type"] == "approval_required")
    run_id = asked[0]["run_id"]
    # Another chat spends the whole cap while this one waits for its decision.
    fake_model.script(reply("Spent it all", cost=Decimal(10)))
    other = new_thread(client, agent_id)
    send(client, other["id"], "Use up the budget")

    with client.stream(
        "POST",
        f"/v1/approvals/{approval_id}/decision",
        json={"decision": "approve"},
        headers=END_USER,
    ) as r:
        assert r.status_code == 200, r.read()
        body = "".join(r.iter_text())
    decided = [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]

    assert types(decided)[-2:] == ["budget_paused", "run_finished"]
    assert decided[-1] == {"type": "run_finished", "status": "paused"}
    assert run_detail(client, run_id)["run"]["status"] == "paused"
    r = client.post(f"/v1/threads/{thread['id']}/resume", headers=END_USER)
    assert r.status_code == 409
    assert error_code(r) == "budget_paused"
    approve_spend(client, agent_id)
    fake_model.script(reply("Noted."))
    resumed = resume(client, thread["id"])
    assert resumed[-2:] == [
        {"type": "message_complete", "text": "Noted."},
        {"type": "run_finished", "status": "completed"},
    ]
