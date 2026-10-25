"""Agent runtime: the LangGraph graph that runs one agent version for a run.

    START -> model --(tool calls)--> tools -> model ... --(no tool calls)--> respond -> END

- `model` calls the model through `get_gateway()` (so every call is metered)
  with the version's instructions, the thread's memory and this turn so far,
  streaming tokens out as TokenEvents.
- `tools` runs each requested tool through `seams.call_agent_tool`, records a
  tool step and streams a ToolCallEvent / ToolResultEvent pair.
- `respond` ends the turn: it commits the turn to the thread's memory and
  streams MessageCompleteEvent with the final text.

Thread memory is LangGraph state saved by the Postgres checkpointer under the
thread's id:

- `messages`: the conversation so far, OpenAI-style, only completed turns.
- `turn`: this run's working messages. Each new message overwrites it, so a
  turn that failed half-way (say, a tool call with no result) never reaches
  the history sent to the model.
- `transcript`: what the thread shows a reader (role, text, created_at).

Where later tickets plug in:

- #16 output guard: in `respond`, before MessageCompleteEvent: guard the final
  text, record guard steps, stream a GuardNoteEvent when it changed something.
- #22 budget pause: `ModelGateway._check_budget` raises before a call; catch
  that in `model` and `interrupt(...)`, then report it from `stream_chat`
  (BudgetPausedEvent, run_finished "paused"). Resume is a Command(resume=...)
  on the same thread, so `turn` survives the pause.
- #24 side effects: side-effect tools are not offered to the model yet (see
  `_offered_tools`), and calling one returns an error to the model. Offer them,
  and in `tools` record an approval and `interrupt(...)` before running one.
"""

import datetime as dt
import json
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Annotated, Any, NotRequired, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime

from hack_tx_2026 import recorder, seams
from hack_tx_2026.checkpointer import get_checkpointer
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import Run, Thread
from hack_tx_2026.gateway import Message, ModelCallError, ToolSchema, get_gateway
from hack_tx_2026.models.events import (
    ErrorEvent,
    MessageCompleteEvent,
    RunFinishedEvent,
    RunFinishedStatus,
    RunStartedEvent,
    TokenEvent,
    ToolCallEvent,
    ToolResultEvent,
)
from hack_tx_2026.models.spec import AgentSpec

# Graph steps per run. One tool turn is model -> tools -> model -> respond;
# this leaves room for a few more and stops a model that loops on tools.
RECURSION_LIMIT = 12


def _append(left: list, right: list) -> list:
    return left + right


class TranscriptEntry(TypedDict):
    role: str  # user | assistant
    text: str
    created_at: str  # ISO 8601, UTC
    run_id: NotRequired[str]  # the run that wrote the entry (#30)


class ChatState(TypedDict, total=False):
    messages: Annotated[list[Message], _append]
    turn: list[Message]
    transcript: Annotated[list[TranscriptEntry], _append]


@dataclass(frozen=True)
class RunContext:
    """What one run needs that is not thread memory. Not checkpointed."""

    run_id: str
    agent_version_id: str
    spec: AgentSpec
    tools: list[seams.Tool] = field(default_factory=list)


def _now_iso() -> str:
    return dt.datetime.now(dt.UTC).isoformat()


def _offered_tools(tools: list[seams.Tool]) -> list[seams.Tool]:
    """The tools the model may call. Side-effect tools wait for approvals (#24)."""
    return [t for t in tools if not t.side_effect]


def _schema(tool: seams.Tool) -> ToolSchema:
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        },
    }


def _model_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    ctx = runtime.context
    write = get_stream_writer()
    turn = state.get("turn", [])
    history = [
        {"role": "system", "content": ctx.spec.instructions},
        *state.get("messages", []),
        *turn,
    ]
    reply = get_gateway().call(
        ctx.run_id,
        model=ctx.spec.model,
        messages=history,
        tools=[_schema(t) for t in _offered_tools(ctx.tools)],
        on_token=lambda text: write(TokenEvent(text=text)),
    )
    return {"turn": [*turn, reply.message]}


def _after_model(state: ChatState) -> str:
    return "tools" if state["turn"][-1].get("tool_calls") else "respond"


def _run_tool(ctx: RunContext, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Runs one tool and records it as a tool step. A failing tool is recorded
    with its error and reported back to the model, which can explain it."""
    started = time.monotonic()
    output: dict[str, Any]
    error: str | None = None
    if name not in {t.name for t in _offered_tools(ctx.tools)}:
        error = f"Tool {name!r} is not available to this agent."
    else:
        try:
            output = seams.call_agent_tool(ctx.agent_version_id, name, arguments)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
    if error is not None:
        output = {"error": error}
    with SessionLocal() as session:
        recorder.record_step(
            session,
            ctx.run_id,
            kind="tool",
            name=name,
            input=arguments,
            output=None if error else output,
            latency_ms=int((time.monotonic() - started) * 1000),
            error=error,
        )
        session.commit()
    return output


def _tools_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    write = get_stream_writer()
    turn = state["turn"]
    results: list[Message] = []
    for call in turn[-1]["tool_calls"]:
        name = call["function"]["name"]
        arguments = json.loads(call["function"].get("arguments") or "{}")
        write(ToolCallEvent(name=name, input=arguments))
        output = _run_tool(runtime.context, name, arguments)
        write(ToolResultEvent(name=name, output=output))
        results.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(output)})
    return {"turn": [*turn, *results]}


def _respond_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    turn = state["turn"]
    text = turn[-1].get("content") or ""
    # The output guard (#16) runs here, before message_complete.
    get_stream_writer()(MessageCompleteEvent(text=text))
    return {
        "messages": turn,
        "turn": [],
        "transcript": [
            {
                "role": "assistant",
                "text": text,
                "created_at": _now_iso(),
                "run_id": runtime.context.run_id,
            }
        ],
    }


def build_graph() -> CompiledStateGraph[ChatState, RunContext, ChatState, ChatState]:
    graph = StateGraph(ChatState, context_schema=RunContext)
    graph.add_node("model", _model_node)
    graph.add_node("tools", _tools_node)
    graph.add_node("respond", _respond_node)
    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", _after_model, ["tools", "respond"])
    graph.add_edge("tools", "model")
    graph.add_edge("respond", END)
    return graph.compile(checkpointer=get_checkpointer())


def _config(thread_id: str) -> RunnableConfig:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": RECURSION_LIMIT}


def read_transcript(thread_id: str) -> list[TranscriptEntry]:
    """A thread's messages as saved in its memory (empty for a new thread)."""
    state = build_graph().get_state(_config(thread_id))
    return list(state.values.get("transcript", []))


def _finish(run_id: str, thread_id: str, status: RunFinishedStatus) -> None:
    with SessionLocal() as session:
        run = session.get(Run, run_id)
        thread = session.get(Thread, thread_id)
        now = dt.datetime.now(dt.UTC)
        if run is not None:
            run.status = status
            run.finished_at = now
        if thread is not None:
            thread.last_updated_at = now
        session.commit()


def stream_chat(
    *, run_id: str, thread_id: str, agent_version_id: str, spec: dict[str, Any], text: str
) -> Iterator[Any]:
    """Runs one chat turn on a thread and yields its stream events, from
    run_started to run_finished. The run row must already exist. Never raises:
    a failure is an ErrorEvent followed by run_finished("failed").

    A re-check (#30) passes its own run id as `thread_id`: it starts from
    fresh memory, and there is no thread row to touch."""
    yield RunStartedEvent(run_id=run_id)
    status: RunFinishedStatus = "completed"
    error: ErrorEvent | None = None
    try:
        context = RunContext(
            run_id=run_id,
            agent_version_id=agent_version_id,
            spec=AgentSpec.model_validate(spec),
            tools=seams.load_agent_tools(agent_version_id),
        )
        user_turn: ChatState = {
            "turn": [{"role": "user", "content": text}],
            "transcript": [
                {"role": "user", "text": text, "created_at": _now_iso(), "run_id": run_id}
            ],
        }
        yield from build_graph().stream(
            user_turn, _config(thread_id), context=context, stream_mode="custom"
        )
    except ModelCallError:
        error = ErrorEvent(code="model_error", message="The model could not answer. Try again.")
    except GraphRecursionError:
        error = ErrorEvent(
            code="too_many_steps", message="The agent took too many steps to answer."
        )
    except Exception:
        error = ErrorEvent(code="internal_error", message="Something went wrong. Try again.")
    if error is not None:
        status = "failed"
        yield error
    _finish(run_id, thread_id, status)
    yield RunFinishedEvent(status=status)
