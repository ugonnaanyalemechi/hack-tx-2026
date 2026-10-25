"""Chat flow (ticket #15): an end user opens threads with an agent, sends
messages and reads back a server-sent event stream from run_started to
run_finished, including one tool call turn through the fake MCP server.

Every model call is the scripted fake model behind the real gateway; every
tool runs on the fake MCP server through the connector layer.
"""

import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

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


# --- Threads ---


def test_creating_a_thread_returns_it(client, agent_id) -> None:
    thread = new_thread(client, agent_id)

    assert thread["id"].startswith("thr_")
    assert thread["agent_id"] == agent_id
    assert thread["title"] == ""
    assert thread["created_at"] and thread["last_updated_at"]


def test_creating_a_thread_for_an_unknown_agent_is_404(client, runtime_db) -> None:
    r = client.post("/v1/agents/agt_nope/threads", headers=END_USER)

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"


# --- Streaming a message ---


def test_a_message_streams_a_tool_turn_from_run_started_to_run_finished(
    client, fake_model, agent_id
) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was not found [1]"),
    )
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "What was revenue?")

    types = [e["type"] for e in events]
    assert types[0] == "run_started"
    assert events[0]["run_id"].startswith("run_")
    assert types[1:3] == ["tool_call", "tool_result"]
    assert events[1] == {"type": "tool_call", "name": "lookup", "input": {"query": "revenue"}}
    assert events[2] == {
        "type": "tool_result",
        "name": "lookup",
        "output": {"result": "[synthetic] no results for 'revenue'"},
    }
    tokens = [e for e in events if e["type"] == "token"]
    assert "".join(e["text"] for e in tokens) == "Revenue was not found [1]"
    assert types[-2:] == ["message_complete", "run_finished"]
    assert events[-2]["text"] == "Revenue was not found [1]"
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    assert types.index("tool_result") < types.index("token")


def test_the_model_sees_the_instructions_the_tool_and_its_result(
    client, fake_model, agent_id
) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"}, id="call_1")]),
        reply("Done"),
    )
    thread = new_thread(client, agent_id)

    send(client, thread["id"], "What was revenue?")

    first, second = fake_model.requests
    assert first.messages[0] == {"role": "system", "content": "Answer from the lookup tool."}
    assert first.messages[-1] == {"role": "user", "content": "What was revenue?"}
    # Side-effect tools are offered too; they run only once approved (#24).
    assert sorted(t["function"]["name"] for t in first.tools) == ["lookup", "note"]
    assert second.messages[-1]["role"] == "tool"
    assert second.messages[-1]["tool_call_id"] == "call_1"
    assert json.loads(second.messages[-1]["content"]) == {
        "result": "[synthetic] no results for 'revenue'"
    }


def test_the_run_and_its_steps_are_recorded(client, fake_model, agent_id) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Done"),
    )
    thread = new_thread(client, agent_id)

    run_id = send(client, thread["id"], "What was revenue?")[0]["run_id"]

    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["run"]["entry_point"] == "chat"
    assert detail["run"]["status"] == "completed"
    assert detail["run"]["user_id"] == "usr_end_user"
    assert detail["run"]["duration_ms"] is not None
    assert [(s["kind"], s["name"]) for s in detail["steps"]] == [
        ("model", "gemini/gemini-3.8-flash"),
        ("tool", "lookup"),
        ("model", "gemini/gemini-3.8-flash"),
    ]
    assert all(s["error"] is None for s in detail["steps"])


def test_a_model_failure_streams_an_error_then_run_finished_failed(
    client, fake_model, agent_id
) -> None:
    fake_model.script(RuntimeError("provider is down"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Hello?")

    assert [e["type"] for e in events] == ["run_started", "error", "run_finished"]
    assert events[1]["code"] == "model_error"
    assert events[1]["message"]
    assert events[2] == {"type": "run_finished", "status": "failed"}
    detail = client.get(f"/v1/runs/{events[0]['run_id']}", headers=ADMIN).json()
    assert detail["run"]["status"] == "failed"
    [step] = detail["steps"]
    assert "provider is down" in step["error"]


def test_a_failed_turn_is_left_out_of_the_next_turns_memory(client, fake_model, agent_id) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        RuntimeError("provider is down"),
        reply("Hi again"),
    )
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "What was revenue?")

    events = send(client, thread["id"], "Hello?")

    assert events[-1] == {"type": "run_finished", "status": "completed"}
    assert fake_model.requests[-1].messages[1:] == [{"role": "user", "content": "Hello?"}]


def test_a_side_effect_tool_is_not_run_without_approval(client, fake_model, agent_id) -> None:
    fake_model.script(reply(tool_calls=[tool_call("note", {"text": "remember this"})]))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Record a note")

    # The run stops on an approval instead (#24, tests/test_flow_approvals.py).
    assert "tool_result" not in [e["type"] for e in events]
    assert events[-1] == {"type": "run_finished", "status": "awaiting_approval"}
    detail = client.get(f"/v1/runs/{events[0]['run_id']}", headers=ADMIN).json()
    assert [s["kind"] for s in detail["steps"] if s["kind"] == "tool"] == []


# --- Memory and isolation ---


def test_a_follow_up_message_remembers_the_earlier_turns(client, fake_model, agent_id) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was not found."),
        reply("You asked about revenue."),
    )
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "What was revenue?")

    send(client, thread["id"], "What did I ask?")

    history = fake_model.requests[-1].messages
    assert [m["role"] for m in history] == [
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
    ]
    assert history[1]["content"] == "What was revenue?"
    assert history[4]["content"] == "Revenue was not found."
    assert history[5]["content"] == "What did I ask?"


def test_separate_threads_never_share_memory(client, fake_model, agent_id) -> None:
    fake_model.script(reply("About revenue."), reply("About costs."), reply("Costs again."))
    first = new_thread(client, agent_id)
    second = new_thread(client, agent_id)
    send(client, first["id"], "Tell me about revenue")
    send(client, second["id"], "Tell me about costs")

    send(client, second["id"], "And again?")

    contents = [m["content"] for m in fake_model.requests[-1].messages[1:]]
    assert contents == ["Tell me about costs", "About costs.", "And again?"]


class EchoTogether:
    """Answers only once `parties` calls are in flight at the same time, so a
    test that finishes proves the runs overlapped."""

    def __init__(self, parties: int) -> None:
        self.barrier = threading.Barrier(parties, timeout=10)

    def complete(self, *, model, messages, tools, on_token):
        self.barrier.wait()
        answer = reply(f"You said: {messages[-1]['content']}")
        if on_token is not None:
            on_token(answer.text)
        return answer


def test_two_threads_can_run_at_once_without_mixing(client, install_model, agent_id) -> None:
    install_model(EchoTogether(parties=2))
    threads = [new_thread(client, agent_id) for _ in range(2)]
    questions = ["Question one", "Question two"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        streams = list(pool.map(lambda t, q: send(client, t["id"], q), threads, questions))

    for thread, question, events in zip(threads, questions, streams, strict=True):
        assert events[-2] == {"type": "message_complete", "text": f"You said: {question}"}
        assert events[-1] == {"type": "run_finished", "status": "completed"}
        messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
        assert [(m["role"], m["text"]) for m in messages] == [
            ("user", question),
            ("assistant", f"You said: {question}"),
        ]


# --- Reading threads and messages ---


def test_a_threads_messages_are_read_back_in_order(client, fake_model, agent_id) -> None:
    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was not found."),
        reply("You asked about revenue."),
    )
    thread = new_thread(client, agent_id)
    assert client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json() == []
    send(client, thread["id"], "What was revenue?")
    send(client, thread["id"], "What did I ask?")

    r = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER)

    assert r.status_code == 200
    messages = r.json()
    assert [(m["role"], m["text"]) for m in messages] == [
        ("user", "What was revenue?"),
        ("assistant", "Revenue was not found."),
        ("user", "What did I ask?"),
        ("assistant", "You asked about revenue."),
    ]
    stamps = [m["created_at"] for m in messages]
    assert stamps == sorted(stamps)


def test_a_failed_turn_keeps_the_question_without_an_answer(client, fake_model, agent_id) -> None:
    fake_model.script(RuntimeError("provider is down"))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "Hello?")

    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()

    assert [(m["role"], m["text"]) for m in messages] == [("user", "Hello?")]


def test_threads_list_the_callers_own_newest_first(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Hi"))
    older = new_thread(client, agent_id)
    newer = new_thread(client, agent_id)
    new_thread(client, agent_id, headers=BUILDER)  # someone else's
    send(client, older["id"], "Talk about revenue")  # now the most recently active

    r = client.get(f"/v1/agents/{agent_id}/threads", headers=END_USER)

    assert r.status_code == 200
    body = r.json()
    assert [t["id"] for t in body["items"]] == [older["id"], newer["id"]]
    assert body["items"][0]["title"] == "Talk about revenue"
    assert body["next_cursor"] is None


def test_thread_list_pages_with_a_cursor(client, agent_id) -> None:
    made = [new_thread(client, agent_id)["id"] for _ in range(3)]

    first = client.get(
        f"/v1/agents/{agent_id}/threads", params={"limit": 2}, headers=END_USER
    ).json()
    second = client.get(
        f"/v1/agents/{agent_id}/threads",
        params={"limit": 2, "cursor": first["next_cursor"]},
        headers=END_USER,
    ).json()

    assert [t["id"] for t in first["items"]] == made[::-1][:2]
    assert [t["id"] for t in second["items"]] == made[::-1][2:]
    assert second["next_cursor"] is None


# --- Ownership ---


def test_someone_elses_thread_cannot_be_read_or_posted_to(client, fake_model, agent_id) -> None:
    thread = new_thread(client, agent_id)

    read = client.get(f"/v1/threads/{thread['id']}/messages", headers=BUILDER)
    post = client.post(f"/v1/threads/{thread['id']}/messages", json={"text": "Hi"}, headers=BUILDER)

    for r in (read, post):
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"
    assert fake_model.requests == []


def test_an_unknown_thread_is_404(client, runtime_db) -> None:
    read = client.get("/v1/threads/thr_nope/messages", headers=END_USER)
    post = client.post("/v1/threads/thr_nope/messages", json={"text": "Hi"}, headers=END_USER)

    for r in (read, post):
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "thread_not_found"


def test_an_agent_with_no_live_version_cannot_be_chatted_with(
    client, fake_model, runtime_db
) -> None:
    spec = {
        "spec_version": 1,
        "name": "Draft Agent",
        "slug": "draft-agent",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Be helpful.",
        "budget": {"monthly_cap": 10.0},
        "evals": {"min_score": 0.8},
    }
    r = client.post("/v1/agents", json={"spec_yaml": yaml.safe_dump(spec)}, headers=BUILDER)
    thread = new_thread(client, r.json()["id"])

    post = client.post(
        f"/v1/threads/{thread['id']}/messages", json={"text": "Hi"}, headers=END_USER
    )

    assert post.status_code == 409
    assert post.json()["error"]["code"] == "no_live_version"
    assert fake_model.requests == []
