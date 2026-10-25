"""Model gateway flow: every model call is metered into the run log.

No chat endpoint exists yet (#15), so these tests call the gateway's public
interface and read what it recorded through the admin run-detail API.
"""

import ast
from decimal import Decimal
from pathlib import Path

import pytest

from hack_tx_2026 import gateway
from hack_tx_2026.fake_model import rate_limited, reply, tool_call
from hack_tx_2026.models.spec import ACCEPTED_MODEL

ADMIN = {"X-User-Id": "usr_admin"}
HELLO = [{"role": "user", "content": "Hello"}]


def run_detail(client, run_id: str) -> dict:
    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def test_model_step_records_tokens_cost_and_latency_with_thinking_billed_as_output(
    client, fake_model, run_id
) -> None:
    fake_model.script(
        reply(
            "Hi there",
            usage=gateway.Usage(
                input_tokens=1000, cached_input_tokens=200, output_tokens=300, thinking_tokens=500
            ),
        )
    )

    gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    detail = run_detail(client, run_id)
    [step] = detail["steps"]
    assert step["kind"] == "model"
    assert step["name"] == ACCEPTED_MODEL
    assert step["input_tokens"] == 1000
    assert step["cached_input_tokens"] == 200
    assert step["output_tokens"] == 800  # 300 visible + 500 thinking
    # 800 uncached input at $0.75/M + 200 cached at $0.075/M + 800 output at $3.75/M
    assert step["cost"] == "0.003615"
    assert isinstance(step["latency_ms"], int) and step["latency_ms"] >= 0
    assert step["error"] is None
    assert detail["run"]["cost_total"] == "0.003615"


def test_run_cost_total_is_the_exact_sum_of_its_steps(client, fake_model, run_id) -> None:
    fake_model.script(
        reply("one", cost=Decimal("0.1")),
        reply("two", cost=Decimal("0.2")),
        reply("three", cost=Decimal("2.000004")),
    )

    for _ in range(3):
        gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    detail = run_detail(client, run_id)
    assert [s["sequence"] for s in detail["steps"]] == [1, 2, 3]
    assert [s["cost"] for s in detail["steps"]] == ["0.100000", "0.200000", "2.000004"]
    assert detail["run"]["cost_total"] == "2.300004"


def test_step_cost_rounds_to_six_places_and_the_total_adds_rounded_steps(
    client, fake_model, run_id
) -> None:
    one_input_token = gateway.Usage(input_tokens=1)  # $0.00000075
    fake_model.script(*(reply("hi", usage=one_input_token) for _ in range(3)))

    for _ in range(3):
        gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    detail = run_detail(client, run_id)
    assert [s["cost"] for s in detail["steps"]] == ["0.000001"] * 3
    assert detail["run"]["cost_total"] == "0.000003"


def test_rate_limited_call_retries_with_backoff_then_records_one_step(
    client, fake_model, backoff_sleeps, run_id
) -> None:
    fake_model.script(rate_limited(), rate_limited(), reply("Finally", cost=Decimal("0.5")))

    result = gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    assert result.text == "Finally"
    assert backoff_sleeps == [1.0, 2.0]
    [step] = run_detail(client, run_id)["steps"]
    assert step["error"] is None
    assert step["cost"] == "0.500000"


def test_call_still_rate_limited_after_retries_is_recorded_as_failed(
    client, fake_model, backoff_sleeps, run_id
) -> None:
    fake_model.script(*(rate_limited() for _ in range(4)))

    with pytest.raises(gateway.ModelCallError):
        gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    assert backoff_sleeps == [1.0, 2.0, 4.0]
    detail = run_detail(client, run_id)
    [step] = detail["steps"]
    assert step["kind"] == "model"
    assert "rate limit" in step["error"].lower()
    assert step["cost"] is None
    assert step["output_tokens"] is None
    assert detail["run"]["cost_total"] == "0.000000"


LOOKUP = {
    "type": "function",
    "function": {
        "name": "lookup",
        "description": "Look up a filing",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
    },
}


def test_tool_call_reply_carries_the_message_to_continue_the_conversation(
    client, fake_model, run_id
) -> None:
    fake_model.script(reply(tool_calls=[tool_call("lookup", {"query": "Q3 revenue"})]))

    result = gateway.get_gateway().call(
        run_id, model=ACCEPTED_MODEL, messages=HELLO, tools=[LOOKUP]
    )

    assert fake_model.requests[0].tools == [LOOKUP]
    assert [(c.name, c.arguments) for c in result.tool_calls] == [
        ("lookup", {"query": "Q3 revenue"})
    ]
    assert result.message["role"] == "assistant"
    assert result.message["tool_calls"][0]["id"] == result.tool_calls[0].id
    assert [s["kind"] for s in run_detail(client, run_id)["steps"]] == ["model"]


def test_reply_text_streams_to_the_token_callback(client, fake_model, run_id) -> None:
    fake_model.script(reply("Revenue grew 12% in Q3."))
    tokens: list[str] = []

    result = gateway.get_gateway().call(
        run_id, model=ACCEPTED_MODEL, messages=HELLO, on_token=tokens.append
    )

    assert len(tokens) > 1
    assert "".join(tokens) == result.text == "Revenue grew 12% in Q3."


def test_model_without_a_price_is_refused_before_it_is_called(client, fake_model, run_id) -> None:
    fake_model.script(reply("never sent"))

    with pytest.raises(gateway.UnpricedModelError):
        gateway.get_gateway().call(run_id, model="gemini/unpriced-model", messages=HELLO)

    assert fake_model.requests == []
    assert run_detail(client, run_id)["steps"] == []


MODEL_LIBRARIES = ("litellm", "openai", "google.genai", "google.generativeai", "langchain_google")


def test_only_the_gateway_imports_a_model_library() -> None:
    src = Path(gateway.__file__).parent
    importers = set()
    for path in src.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            if any(n == lib or n.startswith(lib + ".") for n in names for lib in MODEL_LIBRARIES):
                importers.add(path.relative_to(src).as_posix())

    assert importers == {"gateway.py"}


def test_call_for_an_unknown_run_is_refused_before_the_model_is_called(fake_model) -> None:
    fake_model.script(reply("never sent"))

    with pytest.raises(LookupError):
        gateway.get_gateway().call("run_missing", model=ACCEPTED_MODEL, messages=HELLO)

    assert fake_model.requests == []
