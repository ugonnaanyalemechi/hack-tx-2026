"""Output guard (ticket #16): before the final message is sent, the guard
strips secrets and, when the spec asks, requires a citation. It tells the user
what it changed with a guard_note event that arrives before message_complete,
and records an `output_guard` step in the run.

Every model call is the scripted fake model behind the real gateway.
"""

import json
from collections.abc import Iterator

import pytest
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import agent_runtime, checkpointer, connectors, gateway, seams
from hack_tx_2026.fake_model import ScriptedModel, reply

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


def deploy_agent(client, db_session, guardrails: dict | None) -> str:
    """A deployed agent owned by usr_builder, granted the fake MCP server."""
    spec: dict = {
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


@pytest.fixture
def agent_id(client, db_session, runtime_db) -> str:
    """Guardrails left out of the spec: both default on."""
    return deploy_agent(client, db_session, None)


@pytest.fixture
def no_guardrails_agent_id(client, db_session, runtime_db) -> str:
    return deploy_agent(client, db_session, {"require_citation": False, "strip_secrets": False})


@pytest.fixture
def secrets_only_agent_id(client, db_session, runtime_db) -> str:
    return deploy_agent(client, db_session, {"require_citation": False, "strip_secrets": True})


@pytest.fixture
def citation_only_agent_id(client, db_session, runtime_db) -> str:
    return deploy_agent(client, db_session, {"require_citation": True, "strip_secrets": False})


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


def guard_steps(client, events: list[dict]) -> list[dict]:
    detail = client.get(f"/v1/runs/{events[0]['run_id']}", headers=ADMIN).json()
    return [s for s in detail["steps"] if s["kind"] == "guard"]


AWS_KEY = "AKIAIOSFODNN7EXAMPLE"
API_KEY = "sk-abcdefghijklmnopqrstuvwx1234"


# --- Secrets ---


def test_a_secret_never_appears_in_the_final_message(client, fake_model, agent_id) -> None:
    fake_model.script(reply(f"The key is {AWS_KEY} and the token {API_KEY} [1]"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Show me the keys")

    [complete] = [e for e in events if e["type"] == "message_complete"]
    assert AWS_KEY not in complete["text"]
    assert API_KEY not in complete["text"]
    assert complete["text"] == "The key is [redacted] and the token [redacted] [1]"
    [note] = [e for e in events if e["type"] == "guard_note"]
    assert "secret" in note["note"].lower()


def test_assigned_passwords_and_private_keys_are_stripped(client, fake_model, agent_id) -> None:
    pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----"
    fake_model.script(reply(f"Use password: hunter2hunter2 or\n{pem}\nSee [1]"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Credentials?")

    [complete] = [e for e in events if e["type"] == "message_complete"]
    assert "hunter2hunter2" not in complete["text"]
    assert "MIIEvQIBADANBg" not in complete["text"]
    assert "See [1]" in complete["text"]


def test_the_stripped_text_is_what_the_thread_remembers(client, fake_model, agent_id) -> None:
    fake_model.script(reply(f"Key {AWS_KEY} [1]"), reply("Ok [1]"))
    thread = new_thread(client, agent_id)
    send(client, thread["id"], "Show me the key")

    send(client, thread["id"], "Again")

    sent_to_model = json.dumps(fake_model.requests[-1].messages)
    assert AWS_KEY not in sent_to_model
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert AWS_KEY not in json.dumps(messages)


def test_a_clean_answer_with_a_citation_passes_untouched(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Revenue was 5 million [1]."))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Revenue?")

    assert "guard_note" not in types(events)
    [complete] = [e for e in events if e["type"] == "message_complete"]
    assert complete["text"] == "Revenue was 5 million [1]."


# --- Citations ---


@pytest.mark.parametrize(
    "answer",
    [
        "Revenue was 5 million [1].",
        "Revenue was 5 million (source: 10-K 2024).",
        "Revenue was 5 million [Source: 10-K 2024].",
        "Revenue was 5 million, see https://example.com/10k.",
    ],
)
def test_these_count_as_citations(client, fake_model, agent_id, answer: str) -> None:
    fake_model.script(reply(answer))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Revenue?")

    assert "guard_note" not in types(events)
    assert [e for e in events if e["type"] == "message_complete"][0]["text"] == answer


def test_an_answer_without_a_required_citation_is_blocked_with_a_note(
    client, fake_model, agent_id
) -> None:
    fake_model.script(reply("Revenue was 5 million."))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Revenue?")

    [complete] = [e for e in events if e["type"] == "message_complete"]
    assert "5 million" not in complete["text"]
    assert complete["text"]
    [note] = [e for e in events if e["type"] == "guard_note"]
    assert "citation" in note["note"].lower()
    assert events[-1] == {"type": "run_finished", "status": "completed"}
    messages = client.get(f"/v1/threads/{thread['id']}/messages", headers=END_USER).json()
    assert "5 million" not in json.dumps(messages)


def test_the_guard_note_arrives_before_message_complete(client, fake_model, agent_id) -> None:
    fake_model.script(reply(f"No citation here {AWS_KEY}"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Revenue?")

    order = types(events)
    assert order.index("guard_note") < order.index("message_complete")
    assert order.index("token") < order.index("guard_note")


# --- Recording ---


def test_the_guard_step_is_recorded_in_the_run(client, fake_model, agent_id) -> None:
    fake_model.script(reply(f"Key {AWS_KEY}"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Show me the key")

    [step] = guard_steps(client, events)
    assert step["name"] == "output_guard"
    assert step["error"] is None
    assert AWS_KEY not in json.dumps(step)


def test_the_guard_step_is_recorded_even_when_nothing_changed(client, fake_model, agent_id) -> None:
    fake_model.script(reply("Fine [1]"))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Hi")

    [step] = guard_steps(client, events)
    assert step["name"] == "output_guard"


# --- Spec switches ---


def test_both_guardrails_can_be_turned_off(client, fake_model, no_guardrails_agent_id) -> None:
    answer = f"Key {AWS_KEY}, no citation"
    fake_model.script(reply(answer))
    thread = new_thread(client, no_guardrails_agent_id)

    events = send(client, thread["id"], "Show me the key")

    assert "guard_note" not in types(events)
    assert [e for e in events if e["type"] == "message_complete"][0]["text"] == answer


def test_strip_secrets_alone_does_not_require_a_citation(
    client, fake_model, secrets_only_agent_id
) -> None:
    fake_model.script(reply(f"Key {AWS_KEY}, no citation"))
    thread = new_thread(client, secrets_only_agent_id)

    events = send(client, thread["id"], "Show me the key")

    [complete] = [e for e in events if e["type"] == "message_complete"]
    assert complete["text"] == "Key [redacted], no citation"


def test_require_citation_alone_leaves_secrets_alone(
    client, fake_model, citation_only_agent_id
) -> None:
    answer = f"Key {AWS_KEY} [1]"
    fake_model.script(reply(answer))
    thread = new_thread(client, citation_only_agent_id)

    events = send(client, thread["id"], "Show me the key")

    assert [e for e in events if e["type"] == "message_complete"][0]["text"] == answer
