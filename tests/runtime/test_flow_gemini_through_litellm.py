"""The real model client: Gemini through LiteLLM, faked at LiteLLM's completion call.

No test calls Gemini. These replace only `litellm.completion` with canned
LiteLLM responses shaped like Gemini's, so LiteLLM's own response types and
errors go through the gateway, and check what it recorded through the admin
run-detail API.
"""

import functools
from collections.abc import Iterator
from decimal import Decimal

import litellm
import pytest
from litellm.exceptions import MidStreamFallbackError
from litellm.types.utils import Delta, ModelResponseStream, StreamingChoices
from litellm.types.utils import Usage as LiteLLMUsage

from hack_tx_2026 import gateway
from hack_tx_2026.models.spec import ACCEPTED_MODEL

ADMIN = {"X-User-Id": "usr_admin"}
HELLO = [{"role": "user", "content": "Hello"}]
LOOKUP = {
    "type": "function",
    "function": {
        "name": "lookup",
        "description": "Look up a filing",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
    },
}


def gemini_usage() -> LiteLLMUsage:
    """Usage as LiteLLM reports Gemini's: completion_tokens already includes thinking."""
    return LiteLLMUsage(
        prompt_tokens=1000,
        completion_tokens=800,
        total_tokens=1800,
        prompt_tokens_details={"cached_tokens": 200},
        completion_tokens_details={"reasoning_tokens": 500},
    )


def gemini_response(message: dict) -> litellm.ModelResponse:
    return litellm.ModelResponse(
        model=ACCEPTED_MODEL,
        choices=[{"index": 0, "finish_reason": "stop", "message": message}],
        usage=gemini_usage(),
    )


class FakeCompletion:
    """Stands in for `litellm.completion`, answering each call with the next item."""

    def __init__(self, *items):
        self.items = list(items)
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def run_detail(client, run_id: str) -> dict:
    r = client.get(f"/v1/runs/{run_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


def test_gemini_thinking_tokens_are_billed_as_output(client, install_gateway, run_id) -> None:
    completion = FakeCompletion(gemini_response({"role": "assistant", "content": "Hi there"}))
    install_gateway(gateway.LiteLLMClient(completion=completion))

    result = gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    assert result.text == "Hi there"
    assert completion.calls[0]["model"] == ACCEPTED_MODEL
    assert completion.calls[0]["reasoning_effort"] == "low"
    detail = run_detail(client, run_id)
    [step] = detail["steps"]
    assert step["input_tokens"] == 1000
    assert step["cached_input_tokens"] == 200
    assert step["output_tokens"] == 800  # 300 visible + 500 thinking, billed once
    assert step["cost"] == "0.003615"
    assert detail["run"]["cost_total"] == "0.003615"


def test_gemini_tool_call_keeps_its_thought_signature_for_the_next_turn(
    client, install_gateway, run_id
) -> None:
    signed_call = {
        "id": "call_1",
        "type": "function",
        "function": {"name": "lookup", "arguments": '{"query": "Q3 revenue"}'},
        "provider_specific_fields": {"thought_signature": "c2lnbmF0dXJl"},
    }
    completion = FakeCompletion(
        gemini_response({"role": "assistant", "content": None, "tool_calls": [signed_call]})
    )
    install_gateway(gateway.LiteLLMClient(completion=completion))

    result = gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    assert result.tool_calls == [
        gateway.ToolCall(id="call_1", name="lookup", arguments={"query": "Q3 revenue"})
    ]
    [sent_back] = result.message["tool_calls"]
    assert sent_back["provider_specific_fields"] == {"thought_signature": "c2lnbmF0dXJl"}


def rate_limit_error() -> litellm.RateLimitError:
    return litellm.RateLimitError("429 RESOURCE_EXHAUSTED", llm_provider="gemini", model="x")


@pytest.mark.parametrize(
    "error",
    [
        rate_limit_error(),
        litellm.ServiceUnavailableError("503 UNAVAILABLE", llm_provider="gemini", model="x"),
    ],
    ids=["rate_limited", "unavailable"],
)
def test_litellm_rate_limit_or_unavailable_error_is_retried(
    client, install_gateway, backoff_sleeps, run_id, error
) -> None:
    completion = FakeCompletion(
        error, gemini_response({"role": "assistant", "content": "Hi there"})
    )
    install_gateway(gateway.LiteLLMClient(completion=completion))

    result = gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO)

    assert result.text == "Hi there"
    assert backoff_sleeps == [1.0]
    [step] = run_detail(client, run_id)["steps"]
    assert step["error"] is None


TEXT_CHUNKS = ["Revenue ", "grew ", "12%."]


def gemini_stream() -> list[ModelResponseStream]:
    """Chunks as LiteLLM streams them: text deltas, a finish chunk, then usage."""
    chunks = [
        ModelResponseStream(
            model=ACCEPTED_MODEL, choices=[StreamingChoices(delta=Delta(content=t))]
        )
        for t in TEXT_CHUNKS
    ]
    chunks.append(
        ModelResponseStream(
            model=ACCEPTED_MODEL,
            choices=[StreamingChoices(delta=Delta(content=None), finish_reason="stop")],
            usage=gemini_usage(),
        )
    )
    return chunks


def failing_stream(chunks: list[ModelResponseStream]) -> Iterator[ModelResponseStream]:
    """Yields the chunks, then fails the way LiteLLM reports a 429 on a stream."""
    yield from chunks
    raise MidStreamFallbackError(
        "429 RESOURCE_EXHAUSTED",
        model=ACCEPTED_MODEL,
        llm_provider="gemini",
        original_exception=rate_limit_error(),
        is_pre_first_chunk=not chunks,
    )


def test_streamed_gemini_reply_sends_tokens_and_is_metered(client, install_gateway, run_id) -> None:
    completion = FakeCompletion(iter(gemini_stream()))
    install_gateway(gateway.LiteLLMClient(completion=completion))
    tokens: list[str] = []

    result = gateway.get_gateway().call(
        run_id, model=ACCEPTED_MODEL, messages=HELLO, on_token=tokens.append
    )

    assert tokens == TEXT_CHUNKS
    assert result.text == "Revenue grew 12%."
    assert completion.calls[0]["stream"] is True
    [step] = run_detail(client, run_id)["steps"]
    assert step["output_tokens"] == 800
    assert step["cost"] == "0.003615"


def test_stream_rate_limited_before_the_first_token_is_retried(
    client, install_gateway, backoff_sleeps, run_id
) -> None:
    completion = FakeCompletion(failing_stream([]), iter(gemini_stream()))
    install_gateway(gateway.LiteLLMClient(completion=completion))
    tokens: list[str] = []

    gateway.get_gateway().call(run_id, model=ACCEPTED_MODEL, messages=HELLO, on_token=tokens.append)

    assert tokens == TEXT_CHUNKS
    assert backoff_sleeps == [1.0]
    [step] = run_detail(client, run_id)["steps"]
    assert step["error"] is None


def test_stream_failing_after_the_first_token_is_not_retried(
    client, install_gateway, backoff_sleeps, run_id
) -> None:
    completion = FakeCompletion(failing_stream(gemini_stream()[:1]), iter(gemini_stream()))
    install_gateway(gateway.LiteLLMClient(completion=completion))
    tokens: list[str] = []

    with pytest.raises(gateway.ModelCallError):
        gateway.get_gateway().call(
            run_id, model=ACCEPTED_MODEL, messages=HELLO, on_token=tokens.append
        )

    assert tokens == ["Revenue "]  # never repeated
    assert backoff_sleeps == []
    [step] = run_detail(client, run_id)["steps"]
    assert step["error"]


def test_real_litellm_call_with_tools_streams_and_is_metered(
    client, install_gateway, run_id
) -> None:
    # LiteLLM's own mock: no network, but its real request and stream handling.
    completion = functools.partial(litellm.completion, mock_response="Revenue grew 12% in Q3.")
    install_gateway(gateway.LiteLLMClient(api_key="test-key", completion=completion))
    tokens: list[str] = []

    result = gateway.get_gateway().call(
        run_id, model=ACCEPTED_MODEL, messages=HELLO, tools=[LOOKUP], on_token=tokens.append
    )

    assert "".join(tokens) == result.text == "Revenue grew 12% in Q3."
    [step] = run_detail(client, run_id)["steps"]
    assert step["error"] is None
    assert step["output_tokens"] > 0
    assert Decimal(step["cost"]) > 0
