"""Chat runtime robustness: a dropped connection, concurrent chats, a busy
thread, bad tool arguments, unexpected failures and empty messages.

Every model call is the scripted fake model (or a small blocking stand-in)
behind the real gateway; every tool runs on the fake MCP server.
"""

import json
import logging
import socket
import threading
import time
from collections.abc import Iterator

import httpx
import pytest
import uvicorn
import yaml
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import agent_runtime, checkpointer, connectors, gateway, seams
from hack_tx_2026.fake_model import ScriptedModel, reply

ADMIN = {"X-User-Id": "usr_admin"}
BUILDER = {"X-User-Id": "usr_builder"}
END_USER = {"X-User-Id": "usr_end_user"}

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
    "guardrails": {"require_citation": False, "strip_secrets": False},
}


@pytest.fixture
def runtime_db(test_engine, client, monkeypatch) -> Iterator[None]:
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


def events_of(body: str) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in body.splitlines()
        if line.startswith("data: ")
    ]


def send(client, thread_id: str, text: str, headers=END_USER) -> list[dict]:
    with client.stream(
        "POST", f"/v1/threads/{thread_id}/messages", json={"text": text}, headers=headers
    ) as r:
        assert r.status_code == 200, r.read()
        body = "".join(r.iter_text())
    return events_of(body)


class Gate:
    """A model client that holds every call until released, so a test can act
    while a run is in flight."""

    def __init__(self, answer: str = "Done.") -> None:
        self.started = threading.Event()
        self.release = threading.Event()
        self.answer = answer

    def complete(self, *, model, messages, tools, on_token):
        self.started.set()
        assert self.release.wait(timeout=20), "gate was never released"
        answer = reply(self.answer)
        if on_token is not None:
            on_token(answer.text)
        return answer


class EchoTogether:
    def __init__(self, parties: int) -> None:
        self.barrier = threading.Barrier(parties, timeout=20)

    def complete(self, *, model, messages, tools, on_token):
        self.barrier.wait()
        answer = reply("ok")
        if on_token is not None:
            on_token(answer.text)
        return answer


# --- A dropped connection ---


def test_a_client_that_disconnects_mid_stream_leaves_no_running_run(
    client, install_model, agent_id
) -> None:
    gate = Gate()
    install_model(gate)
    thread = new_thread(client, agent_id)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(client.app, host="127.0.0.1", port=port, lifespan="off", log_level="error")
    )
    runner = threading.Thread(target=server.run, daemon=True)
    runner.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=20) as http:
            with http.stream(
                "POST",
                f"/v1/threads/{thread['id']}/messages",
                json={"text": "Hello"},
                headers=END_USER,
            ) as r:
                first = next(line for line in r.iter_lines() if line.startswith("data: "))
                run_id = json.loads(first.removeprefix("data: "))["run_id"]
                assert gate.started.wait(timeout=10)
            # The with-block closed the connection while the model call is in flight.
        gate.release.set()
        status = "running"
        deadline = time.monotonic() + 10
        while status == "running" and time.monotonic() < deadline:
            time.sleep(0.1)
            status = client.get(f"/v1/runs/{run_id}", headers=ADMIN).json()["run"]["status"]
        assert status == "failed"
    finally:
        gate.release.set()
        server.should_exit = True
        runner.join(timeout=10)


# --- Unexpected failures ---


def test_an_unexpected_failure_is_logged(client, fake_model, agent_id, monkeypatch, caplog) -> None:
    def boom(_):
        raise RuntimeError("tool loader exploded")

    monkeypatch.setattr(seams, "load_agent_tools", boom)
    thread = new_thread(client, agent_id)

    with caplog.at_level(logging.ERROR):
        events = send(client, thread["id"], "Hello")

    assert events[-2]["code"] == "internal_error"
    assert any("tool loader exploded" in (r.exc_text or "") for r in caplog.records)


def test_run_finished_is_sent_even_if_recording_the_finish_fails(
    client, fake_model, agent_id, monkeypatch
) -> None:
    def boom(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(agent_runtime, "_finish", boom)
    fake_model.script(reply("Hi."))
    thread = new_thread(client, agent_id)

    events = send(client, thread["id"], "Hello")

    assert events[-1] == {"type": "run_finished", "status": "completed"}
