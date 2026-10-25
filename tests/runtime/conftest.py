"""Runtime test fixtures: the scripted fake model wired into the model gateway.

Every runtime test drives the model through `fake_model`; no test calls Gemini.
Script the replies, then exercise the HTTP API (or, where no endpoint exists
yet, the gateway's public interface) and check what was recorded:

    fake_model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was $12M [1]", cost=Decimal("0.40")),
    )
"""

import os
from collections.abc import Callable, Iterator
from decimal import Decimal

# Before anything imports litellm: use its bundled cost map, never fetch one.
os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")

import pytest
import yaml
from sqlalchemy.orm import sessionmaker

from hack_tx_2026 import gateway
from hack_tx_2026.db.orm import AgentVersion, Run
from hack_tx_2026.fake_model import ScriptedModel

BUILDER = {"X-User-Id": "usr_builder"}
ADMIN = {"X-User-Id": "usr_admin"}


@pytest.fixture
def backoff_sleeps() -> list[float]:
    """The backoff delays the installed gateway asked for. Nothing really sleeps."""
    return []


@pytest.fixture
def install_gateway(
    test_engine, client, backoff_sleeps
) -> Iterator[Callable[[gateway.ModelClient], None]]:
    """Installs a gateway over the given model client and the test database."""
    session_factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)

    def install(model_client: gateway.ModelClient) -> None:
        gateway.set_gateway(
            gateway.ModelGateway(
                model_client, session_factory=session_factory, sleep=backoff_sleeps.append
            )
        )

    yield install
    gateway.set_gateway(None)


@pytest.fixture
def fake_model(install_gateway) -> ScriptedModel:
    """The scripted fake model, installed behind the gateway."""
    model = ScriptedModel()
    install_gateway(model)
    return model


def _spec_yaml(slug: str) -> str:
    return yaml.safe_dump(
        {
            "spec_version": 1,
            "name": "Gateway Agent",
            "slug": slug,
            "description": "An agent for gateway tests",
            "model": "gemini/gemini-3.8-flash",
            "instructions": "Be helpful.",
            "budget": {"monthly_cap": 10.0},
            "evals": {"min_score": 0.8},
        }
    )


@pytest.fixture
def agent_id(client) -> str:
    """A deployed agent owned by usr_builder."""
    r = client.post("/v1/agents", json={"spec_yaml": _spec_yaml("gateway-agent")}, headers=BUILDER)
    assert r.status_code == 201, r.text
    created = r.json()["id"]
    d = client.post(f"/v1/agents/{created}/versions/1/deploy", headers=BUILDER)
    assert d.status_code == 200, d.text
    return created


@pytest.fixture
def run_id(db_session, agent_id) -> str:
    """A running chat run for the agent.

    Inserted directly until the chat endpoint (#15) can start runs over HTTP.
    """
    version = db_session.query(AgentVersion).filter_by(agent_id=agent_id).one()
    run = Run(
        agent_id=agent_id,
        agent_version_id=version.id,
        user_id="usr_end_user",
        entry_point="chat",
        cost_total=Decimal(0),
    )
    db_session.add(run)
    db_session.commit()
    return run.id
