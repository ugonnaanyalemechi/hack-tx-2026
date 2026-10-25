"""The scripted fake model: a model client that plays back canned replies.

No test calls Gemini. Install it behind a real `ModelGateway` (see
`tests/runtime/conftest.py`) so every scripted call is metered and recorded
exactly like a real one.

    model = ScriptedModel()
    model.script(
        reply(tool_calls=[tool_call("lookup", {"query": "revenue"})]),
        reply("Revenue was $12M [1]", cost=Decimal("2.50")),
    )
"""

import json
import re
from collections import deque
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from hack_tx_2026.gateway import (
    Message,
    ModelResponse,
    RetryableModelError,
    TokenCallback,
    ToolCall,
    ToolSchema,
    Usage,
)

DEFAULT_USAGE = Usage(input_tokens=100, output_tokens=20)


def tool_call(name: str, arguments: dict[str, Any] | None = None, *, id: str = "") -> ToolCall:
    return ToolCall(id=id or f"call_{name}", name=name, arguments=arguments or {})


def rate_limited() -> RetryableModelError:
    """A scripted rate-limit error, which the gateway retries with backoff."""
    return RetryableModelError("Rate limit exceeded (429 RESOURCE_EXHAUSTED, scripted)")


def reply(
    text: str = "",
    *,
    tool_calls: Sequence[ToolCall] = (),
    usage: Usage = DEFAULT_USAGE,
    cost: Decimal | None = None,
) -> ModelResponse:
    """A canned reply. `cost` reports a chosen cost instead of pricing `usage`."""
    message: Message = {"role": "assistant", "content": text or None}
    if tool_calls:
        message["tool_calls"] = [
            {
                "id": c.id,
                "type": "function",
                "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
            }
            for c in tool_calls
        ]
    return ModelResponse(
        text=text, tool_calls=list(tool_calls), usage=usage, message=message, reported_cost=cost
    )


@dataclass(frozen=True)
class ModelRequest:
    """One call the fake received."""

    model: str
    messages: list[Message]
    tools: list[ToolSchema]


class ScriptedModel:
    """Answers each call with the next scripted reply (or raises the next scripted error)."""

    def __init__(self, *items: ModelResponse | Exception) -> None:
        self._script: deque[ModelResponse | Exception] = deque(items)
        self.requests: list[ModelRequest] = []

    def script(self, *items: ModelResponse | Exception) -> None:
        self._script.extend(items)

    def complete(
        self,
        *,
        model: str,
        messages: Sequence[Message],
        tools: Sequence[ToolSchema],
        on_token: TokenCallback | None,
    ) -> ModelResponse:
        self.requests.append(ModelRequest(model, list(messages), list(tools)))
        if not self._script:
            raise AssertionError("ScriptedModel has no scripted reply left")
        item = self._script.popleft()
        if isinstance(item, Exception):
            raise item
        if on_token is not None:
            for chunk in re.findall(r"\S+\s*|\s+", item.text):
                on_token(chunk)
        return item
