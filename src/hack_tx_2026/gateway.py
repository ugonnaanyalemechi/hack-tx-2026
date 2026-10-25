"""Model gateway: the only code that calls a model.

Every call is metered. After the model answers, the gateway records a model
step on the run with its tokens, the cost from the pricing table below and
the latency; the recorder adds that cost to the run's total. On the step,
input_tokens counts every prompt token (cached ones included),
cached_input_tokens the cached share, and output_tokens the visible output
plus thinking tokens, all billed as output.

Rate-limited (429) and unavailable (503) calls are retried with exponential
backoff, but only before the first token streams. A call that still fails is
recorded with its error and raised as ModelCallError. The budget check before
each call belongs in `ModelGateway._check_budget` (#22).

Callers take the process-wide gateway from `get_gateway()` and call it with
OpenAI-style chat messages and tool schemas (the format LiteLLM takes):

    reply = get_gateway().call(run_id, model=spec.model, messages=history, tools=schemas)
    history.append(reply.message)   # verbatim: it carries Gemini's thought signatures

Tests install a gateway over the scripted fake model with `set_gateway()`
(see `fake_model.py` and `tests/runtime/conftest.py`).
"""

import json
import os
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Protocol

from sqlalchemy.orm import Session

from hack_tx_2026 import recorder
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import Run
from hack_tx_2026.models.spec import ACCEPTED_MODEL
from hack_tx_2026.settings import get_settings

Message = dict[str, Any]  # an OpenAI-style chat message
ToolSchema = dict[str, Any]  # {"type": "function", "function": {name, description, parameters}}
TokenCallback = Callable[[str], None]

MILLION = Decimal(1_000_000)


@dataclass(frozen=True)
class ModelPrice:
    """US dollars per million tokens."""

    input: Decimal
    cached_input: Decimal
    output: Decimal


# The one pricing table. Gemini paid tier as listed in October 2026: confirm on
# Google's pricing page before the demo (Google lists these doubling from
# 2027-01-01). Thinking tokens are billed as output.
PRICES: dict[str, ModelPrice] = {
    ACCEPTED_MODEL: ModelPrice(
        input=Decimal("0.75"), cached_input=Decimal("0.075"), output=Decimal("3.75")
    ),
}


@dataclass(frozen=True)
class Usage:
    """Tokens one model call used, as its client reports them."""

    input_tokens: int = 0  # every prompt token, cached ones included
    cached_input_tokens: int = 0
    output_tokens: int = 0  # visible output only
    thinking_tokens: int = 0

    @property
    def billed_output_tokens(self) -> int:
        return self.output_tokens + self.thinking_tokens


def price(model: str, usage: Usage) -> Decimal:
    """The unrounded cost of `usage` on `model`, from the pricing table."""
    rates = PRICES[model]
    uncached = usage.input_tokens - usage.cached_input_tokens
    return (
        uncached * rates.input
        + usage.cached_input_tokens * rates.cached_input
        + usage.billed_output_tokens * rates.output
    ) / MILLION


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ModelResponse:
    """What a model client returns for one call."""

    text: str
    tool_calls: list[ToolCall]
    usage: Usage
    message: Message  # the assistant message to append to the conversation
    # A cost the client already knows. Only the scripted fake sets it, so tests
    # can hit a chosen cost; otherwise the gateway prices `usage`.
    reported_cost: Decimal | None = None


@dataclass(frozen=True)
class ModelReply:
    """What the gateway returns to its caller."""

    text: str
    tool_calls: list[ToolCall]
    message: Message
    step_id: str


class UnpricedModelError(ValueError):
    """The model has no row in PRICES, so a call to it could not be metered."""


class RetryableModelError(Exception):
    """Raised by a client when the provider rate-limits a call (429) or is briefly
    unavailable (503) before sending any token. The gateway retries it."""


class ModelCallError(Exception):
    """Raised by the gateway when a call fails for good. The failed step is already recorded."""


class ModelClient(Protocol):
    def complete(
        self,
        *,
        model: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSchema],
        on_token: TokenCallback | None,
    ) -> ModelResponse: ...


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


@dataclass
class ModelGateway:
    client: ModelClient
    session_factory: Callable[[], Session] = SessionLocal
    # Rate-limited calls are retried after base_delay, 2x, 4x ... seconds.
    max_attempts: int = 4
    base_delay: float = 1.0
    sleep: Callable[[float], None] = field(default=time.sleep)

    def call(
        self,
        run_id: str,
        *,
        model: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSchema] = (),
        on_token: TokenCallback | None = None,
    ) -> ModelReply:
        """Call the model for a run and record the call as a model step.

        Raises ModelCallError, after recording the failed step, if the call
        fails for good. Nothing reaches the model if the model is unpriced
        (UnpricedModelError) or the run is unknown (LookupError).
        """
        if model not in PRICES:
            raise UnpricedModelError(f"no price for model {model!r}")
        self._check_budget(self._agent_of(run_id))
        request = {"messages": list(messages), "tools": list(tools)}
        started = time.monotonic()
        try:
            response = self._complete_with_retry(model, messages, tools, on_token)
        except Exception as exc:
            self._record(
                run_id,
                name=model,
                input=request,
                latency_ms=_elapsed_ms(started),
                error=f"{type(exc).__name__}: {exc}",
            )
            raise ModelCallError(str(exc)) from exc
        latency_ms = _elapsed_ms(started)
        cost = (
            response.reported_cost
            if response.reported_cost is not None
            else price(model, response.usage)
        )
        step_id = self._record(
            run_id,
            name=model,
            input=request,
            output={
                "text": response.text,
                "tool_calls": [vars(c) for c in response.tool_calls],
                "thinking_tokens": response.usage.thinking_tokens,
            },
            input_tokens=response.usage.input_tokens,
            cached_input_tokens=response.usage.cached_input_tokens,
            output_tokens=response.usage.billed_output_tokens,
            cost=cost,
            latency_ms=latency_ms,
        )
        return ModelReply(
            text=response.text,
            tool_calls=response.tool_calls,
            message=response.message,
            step_id=step_id,
        )

    def _agent_of(self, run_id: str) -> str:
        with self.session_factory() as session:
            run = session.get(Run, run_id)
            if run is None:
                raise LookupError(f"run {run_id} not found")
            return run.agent_id

    def _check_budget(self, agent_id: str) -> None:
        """Runs before every model call. The budget pause belongs here (#22):
        call `seams.check_agent_budget(agent_id)` and raise a pause instead of
        calling the model when the agent is paused. Until then every call goes
        ahead."""

    def _complete_with_retry(
        self,
        model: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSchema],
        on_token: TokenCallback | None,
    ) -> ModelResponse:
        for attempt in range(1, self.max_attempts + 1):
            try:
                return self.client.complete(
                    model=model, messages=messages, tools=tools, on_token=on_token
                )
            except RetryableModelError:
                if attempt == self.max_attempts:
                    raise
                self.sleep(self.base_delay * 2 ** (attempt - 1))
        raise AssertionError("unreachable")

    def _record(
        self,
        run_id: str,
        *,
        input: dict[str, Any],
        output: dict[str, Any] | None = None,
        **fields: Any,
    ) -> str:
        with self.session_factory() as session:
            step = recorder.record_step(
                session,
                run_id,
                kind="model",
                input=_jsonable(input),
                output=None if output is None else _jsonable(output),
                **fields,
            )
            session.commit()
            return step.id


RETRYABLE_STATUSES = (429, 503)


class LiteLLMClient:
    """Calls Gemini through LiteLLM. Only the gateway may use it.

    `completion` stands in for `litellm.completion` in tests; no test calls Gemini.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        reasoning_effort: str = "low",
        completion: Callable[..., Any] | None = None,
    ) -> None:
        self._api_key = api_key
        self._reasoning_effort = reasoning_effort
        self._completion = completion

    def complete(
        self,
        *,
        model: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSchema],
        on_token: TokenCallback | None,
    ) -> ModelResponse:
        # Use LiteLLM's bundled cost map instead of fetching one at import.
        os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
        import litellm  # slow to import, so it loads on the first real call

        completion = self._completion or litellm.completion
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": list(messages),
            "reasoning_effort": self._reasoning_effort,
            "api_key": self._api_key or get_settings().gemini_api_key or None,
        }
        if tools:
            kwargs["tools"] = list(tools)
        sent_tokens = False
        try:
            if on_token is None:
                raw = completion(**kwargs)
            else:
                # The request goes out on the first next(), so errors surface in this loop.
                chunks = []
                stream = completion(**kwargs, stream=True, stream_options={"include_usage": True})
                for chunk in stream:
                    chunks.append(chunk)
                    text = chunk.choices[0].delta.content if chunk.choices else None
                    if text:
                        sent_tokens = True
                        on_token(text)
                raw = litellm.stream_chunk_builder(chunks, messages=kwargs["messages"])
        except Exception as exc:
            # A streamed 429 arrives as MidStreamFallbackError, so match on the status.
            # Once tokens went out, a retry would repeat them: let the call fail.
            if getattr(exc, "status_code", None) in RETRYABLE_STATUSES and not sent_tokens:
                raise RetryableModelError(str(exc)) from exc
            raise
        return _from_litellm(raw)


def _from_litellm(raw: Any) -> ModelResponse:
    message = raw.choices[0].message
    usage = raw.usage
    cached = getattr(usage.prompt_tokens_details, "cached_tokens", None) or 0
    thinking = getattr(usage.completion_tokens_details, "reasoning_tokens", None) or 0
    # For Gemini, LiteLLM's completion_tokens already include the thinking tokens.
    visible = (usage.completion_tokens or 0) - thinking
    return ModelResponse(
        text=message.content or "",
        tool_calls=[
            ToolCall(
                id=c.id, name=c.function.name, arguments=json.loads(c.function.arguments or "{}")
            )
            for c in message.tool_calls or []
        ],
        usage=Usage(
            input_tokens=usage.prompt_tokens or 0,
            cached_input_tokens=cached,
            output_tokens=visible,
            thinking_tokens=thinking,
        ),
        # Verbatim, so the next turn sends back Gemini's thought signatures.
        message={"role": "assistant", "content": None, **message.model_dump(exclude_none=True)},
    )


_installed: ModelGateway | None = None


def get_gateway() -> ModelGateway:
    """The process-wide gateway: Gemini through LiteLLM unless one was installed."""
    global _installed
    if _installed is None:
        _installed = ModelGateway(LiteLLMClient())
    return _installed


def set_gateway(gateway: ModelGateway | None) -> None:
    """Install the process-wide gateway (tests install one over the fake model)."""
    global _installed
    _installed = gateway
