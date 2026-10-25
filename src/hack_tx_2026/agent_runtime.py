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

- #16 output guard (done): `respond` calls `output_guard.guard_text`, records an
  `output_guard` step and streams GuardNoteEvents before MessageCompleteEvent.
- #22 budget pause: `ModelGateway._check_budget` raises before a call; catch
  that in `model` and `interrupt(...)`, then report it from `stream_chat`
  (BudgetPausedEvent, run_finished "paused"). Resume is a Command(resume=...)
  on the same thread, so `turn` survives the pause.
- #24 side effects (built): `tools` stops at a side-effect call, records an
  approval and an approval step and streams ApprovalRequiredEvent; the
  `approval` node then `interrupt`s, so the run ends "awaiting_approval".
  `stream_decision` resumes it with Command(resume="approve" | "reject").
"""

import datetime as dt
import json
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.runtime import Runtime
from langgraph.types import Command, interrupt

from hack_tx_2026 import output_guard, recorder, seams
from hack_tx_2026.checkpointer import get_checkpointer
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import Approval, Run, Thread
from hack_tx_2026.gateway import Message, ModelCallError, ToolSchema, get_gateway
from hack_tx_2026.models.events import (
    ApprovalRequiredEvent,
    ErrorEvent,
    GuardNoteEvent,
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


class PendingApproval(TypedDict):
    approval_id: str
    tool_call_id: str
    tool_name: str
    tool_input: dict[str, Any]


class ChatState(TypedDict, total=False):
    messages: Annotated[list[Message], _append]
    turn: list[Message]
    transcript: Annotated[list[TranscriptEntry], _append]
    pending_approval: PendingApproval | None


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
    """The tools the model may call. Side-effect tools run only once approved."""
    return list(tools)


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


def _request_approval(ctx: RunContext, name: str, arguments: dict[str, Any]) -> str:
    """Records a pending approval and its approval step; returns the approval's id."""
    with SessionLocal() as session:
        approval = Approval(run_id=ctx.run_id, tool_name=name, tool_input=arguments)
        session.add(approval)
        session.flush()
        recorder.record_step(
            session,
            ctx.run_id,
            kind="approval",
            name=name,
            # approval_id lets run detail link this step to its approval (#42).
            input={"approval_id": approval.id, "tool_input": arguments},
        )
        session.commit()
        return approval.id


def _tools_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    """Runs the latest model message's tool calls that have no result yet, in
    order. Stops at a side-effect call: records an approval for it and leaves
    it pending for the `approval` node."""
    write = get_stream_writer()
    turn = state["turn"]
    index = max(i for i, m in enumerate(turn) if m.get("tool_calls"))
    calls = turn[index]["tool_calls"]
    answered = {m.get("tool_call_id") for m in turn[index + 1 :]}
    side_effect = {t.name for t in runtime.context.tools if t.side_effect}
    results: list[Message] = []
    for position, call in enumerate(calls):
        if call["id"] in answered:
            continue
        name = call["function"]["name"]
        arguments = json.loads(call["function"].get("arguments") or "{}")
        if name in side_effect:
            update: ChatState = {}
            text = turn[index].get("content") or ""
            first_approval = not any(c["function"]["name"] in side_effect for c in calls[:position])
            if text and first_approval:
                # What the model said before asking is a message of its own.
                write(MessageCompleteEvent(text=text))
                update["transcript"] = [
                    {"role": "assistant", "text": text, "created_at": _now_iso()}
                ]
            approval_id = _request_approval(runtime.context, name, arguments)
            write(
                ApprovalRequiredEvent(approval_id=approval_id, tool_name=name, tool_input=arguments)
            )
            pending: PendingApproval = {
                "approval_id": approval_id,
                "tool_call_id": call["id"],
                "tool_name": name,
                "tool_input": arguments,
            }
            return {**update, "turn": [*turn, *results], "pending_approval": pending}
        write(ToolCallEvent(name=name, input=arguments))
        output = _run_tool(runtime.context, name, arguments)
        write(ToolResultEvent(name=name, output=output))
        results.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(output)})
    return {"turn": [*turn, *results]}


def _after_tools(state: ChatState) -> str:
    return "approval" if state.get("pending_approval") else "model"


# What the model is told when the user rejects a side-effect call.
DECLINED = {
    "error": "declined",
    "message": "The user declined this action, so it was not run. "
    "Do not retry it; explain, or offer another way to help.",
}


def _approval_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    """Waits for the user's decision on the pending side-effect call. The
    interrupt ends this stream; the decision resumes the run here."""
    pending = state["pending_approval"]
    assert pending is not None
    decision = interrupt({"kind": "approval", "approval_id": pending["approval_id"]})
    output: dict[str, Any] = DECLINED
    if decision == "approve":
        write = get_stream_writer()
        name, arguments = pending["tool_name"], pending["tool_input"]
        write(ToolCallEvent(name=name, input=arguments))
        output = _run_tool(runtime.context, name, arguments)
        write(ToolResultEvent(name=name, output=output))
    result: Message = {
        "role": "tool",
        "tool_call_id": pending["tool_call_id"],
        "content": json.dumps(output),
    }
    return {"turn": [*state["turn"], result], "pending_approval": None}


def _guard_answer(ctx: RunContext, text: str) -> str:
    """Runs the output guard on the final text, records its step and streams a
    GuardNoteEvent per change. Returns the text the user gets."""
    started = time.monotonic()
    guardrails = ctx.spec.guardrails
    result = output_guard.guard_text(text, guardrails)
    with SessionLocal() as session:
        recorder.record_step(
            session,
            ctx.run_id,
            kind="guard",
            name="output_guard",
            input={
                "require_citation": guardrails.require_citation,
                "strip_secrets": guardrails.strip_secrets,
            },
            output={
                "secrets_stripped": result.secrets_stripped,
                "blocked": result.blocked,
                "notes": result.notes,
            },
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        session.commit()
    write = get_stream_writer()
    for note in result.notes:
        write(GuardNoteEvent(note=note))
    return result.text


def _respond_node(state: ChatState, runtime: Runtime[RunContext]) -> ChatState:
    turn = state["turn"]
    text = _guard_answer(runtime.context, turn[-1].get("content") or "")
    get_stream_writer()(MessageCompleteEvent(text=text))
    # Memory keeps the guarded text, never what the model first said.
    final: Message = {**turn[-1], "content": text}
    return {
        "messages": [*turn[:-1], final],
        "turn": [],
        "transcript": [{"role": "assistant", "text": text, "created_at": _now_iso()}],
    }


def build_graph() -> CompiledStateGraph[ChatState, RunContext, ChatState, ChatState]:
    graph = StateGraph(ChatState, context_schema=RunContext)
    graph.add_node("model", _model_node)
    graph.add_node("tools", _tools_node)
    graph.add_node("respond", _respond_node)
    graph.add_node("approval", _approval_node)
    graph.add_edge(START, "model")
    graph.add_conditional_edges("model", _after_model, ["tools", "respond"])
    graph.add_conditional_edges("tools", _after_tools, ["approval", "model"])
    graph.add_edge("approval", "tools")
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
    a failure is an ErrorEvent followed by run_finished("failed")."""
    user_turn: ChatState = {
        "turn": [{"role": "user", "content": text}],
        "transcript": [{"role": "user", "text": text, "created_at": _now_iso()}],
    }
    yield from _stream_run(run_id, thread_id, agent_version_id, spec, user_turn)


def stream_decision(
    *, run_id: str, thread_id: str, agent_version_id: str, spec: dict[str, Any], decision: str
) -> Iterator[Any]:
    """Resumes a run stopped on an approval with the user's decision
    ("approve" or "reject") and yields its events, like `stream_chat`."""
    yield from _stream_run(run_id, thread_id, agent_version_id, spec, Command(resume=decision))


def _awaits_approval(
    graph: CompiledStateGraph[ChatState, RunContext, ChatState, ChatState], thread_id: str
) -> bool:
    interrupts = graph.get_state(_config(thread_id)).interrupts
    return any(isinstance(i.value, dict) and i.value.get("kind") == "approval" for i in interrupts)


def _stream_run(
    run_id: str,
    thread_id: str,
    agent_version_id: str,
    spec: dict[str, Any],
    graph_input: ChatState | Command,
) -> Iterator[Any]:
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
        graph = build_graph()
        yield from graph.stream(
            graph_input, _config(thread_id), context=context, stream_mode="custom"
        )
        if _awaits_approval(graph, thread_id):
            status = "awaiting_approval"
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
