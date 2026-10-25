"""owner:runtime's endpoints: threads, messages, streaming, approve, resume,
invoke, flag and re-check. Add routes here, never in app.py.

Streaming endpoints check every precondition before the stream starts (in a
dependency or the route body): an error raised inside the event generator
would reach the client as an empty 200 instead of the shared error shape.
"""

from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from sqlalchemy.orm import Session

from hack_tx_2026 import agent_runtime, chat, invoke
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Approval, Run, Thread
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.chat_api import (
    DecisionRequest,
    FlagRequest,
    MessageOut,
    SendMessageRequest,
    ThreadOut,
)
from hack_tx_2026.models.events import StreamEvent
from hack_tx_2026.models.invoke_api import InvokeRequest, InvokeResponse

router = APIRouter(prefix="/v1", tags=["runtime"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]

_EVENT = TypeAdapter(StreamEvent)


def get_owned_thread(thread_id: str, session: SessionDep, user: UserDep) -> Thread:
    return chat.owned_thread(session, user, thread_id)


OwnedThreadDep = Annotated[Thread, Depends(get_owned_thread)]


def get_open_thread(thread: OwnedThreadDep, session: SessionDep) -> Thread:
    """The caller's thread, if it may take a new message: 409 approval_pending
    while a run on it waits on an approval, 409 budget_paused while it or its
    agent is paused at the budget."""
    chat.ensure_no_pending_approval(session, thread)
    chat.ensure_not_budget_paused(session, thread)
    return thread


OpenThreadDep = Annotated[Thread, Depends(get_open_thread)]


def get_resumed_run(thread: OwnedThreadDep, session: SessionDep) -> tuple[Run, dict[str, Any]]:
    """The thread's paused run, marked running again, with its version's spec:
    409 approval_pending, nothing_to_resume or budget_paused otherwise."""
    return chat.start_resume(session, thread)


ResumedRunDep = Annotated[tuple[Run, dict[str, Any]], Depends(get_resumed_run)]


def get_decidable_approval(approval_id: str, session: SessionDep, user: UserDep) -> Approval:
    return chat.decidable_approval(session, user, approval_id)


DecidableApprovalDep = Annotated[Approval, Depends(get_decidable_approval)]


def get_flaggable_run(run_id: str, session: SessionDep, user: UserDep) -> chat.FlagTarget:
    return chat.flaggable_run(session, user, run_id)


FlaggableRunDep = Annotated[chat.FlagTarget, Depends(get_flaggable_run)]


def _sse(events: Iterator[Any]) -> Iterator[str]:
    for event in events:
        yield f"data: {_EVENT.dump_json(event).decode()}\n\n"


def _release(session: Session) -> None:
    """Gives the request's database connection back to the pool. A stream runs
    for as long as the model takes; without this every open chat would hold a
    connection (idle in a transaction) until it ends. Read what the stream
    needs from ORM objects first: they are detached after this."""
    session.close()


def _stream_response(events: Iterator[Any]) -> StreamingResponse:
    return StreamingResponse(
        _sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/agents/{agent_id}/threads", status_code=201)
def create_thread(agent_id: str, session: SessionDep, user: UserDep) -> ThreadOut:
    return chat.create_thread(session, user, agent_id)


@router.get("/agents/{agent_id}/threads")
def list_threads(
    agent_id: str,
    session: SessionDep,
    user: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[ThreadOut]:
    return chat.list_threads(session, user, agent_id, limit, cursor)


@router.get("/threads/{thread_id}/messages")
def list_messages(thread: OwnedThreadDep) -> list[MessageOut]:
    return chat.read_messages(thread)


@router.post("/threads/{thread_id}/messages")
def send_message(
    body: SendMessageRequest, thread: OpenThreadDep, session: SessionDep, user: UserDep
) -> StreamingResponse:
    """Streams the run's events (models/events.py) as server-sent events."""
    thread_id = thread.id
    run, version = chat.start_chat_run(session, user, thread, body.text)
    events = agent_runtime.stream_chat(
        run_id=run.id,
        thread_id=thread_id,
        agent_version_id=version["agent_version_id"],
        spec=version["spec"],
        text=body.text,
    )
    _release(session)
    return _stream_response(events)


@router.post("/threads/{thread_id}/resume")
def resume_thread(
    thread: OwnedThreadDep, resumed: ResumedRunDep, session: SessionDep
) -> StreamingResponse:
    """Continue: resumes the thread's paused run from its checkpoint and
    streams its events (models/events.py) as server-sent events."""
    run, spec = resumed
    events = agent_runtime.resume_chat(
        run_id=run.id,
        thread_id=thread.id,
        agent_version_id=run.agent_version_id,
        spec=spec,
    )
    _release(session)
    return _stream_response(events)


@router.post("/approvals/{approval_id}/decision")
def decide_approval(
    body: DecisionRequest, approval: DecidableApprovalDep, session: SessionDep, user: UserDep
) -> StreamingResponse:
    """Records the decision and streams the same run, resumed, as server-sent
    events: approve runs the tool, reject tells the agent it was declined."""
    run, spec = chat.decide_approval(session, user, approval, body.decision)
    events = agent_runtime.stream_decision(
        run_id=run.id,
        # A re-check's memory is keyed by its own run id (#30).
        thread_id=run.thread_id or run.id,
        agent_version_id=run.agent_version_id,
        spec=spec,
        decision=body.decision,
    )
    _release(session)
    return _stream_response(events)


@router.post("/runs/{run_id}/flag")
def flag_run(
    body: FlagRequest, target: FlaggableRunDep, session: SessionDep, user: UserDep
) -> StreamingResponse:
    """Files a ticket for the run's answer, then streams a re-check run: the
    same agent version answering the same question on fresh memory."""
    question = target.question
    run, version = chat.start_recheck_run(session, user, target)
    events = agent_runtime.stream_chat(
        run_id=run.id,
        thread_id=run.id,
        agent_version_id=version["agent_version_id"],
        spec=version["spec"],
        text=question,
    )
    _release(session)
    return _stream_response(events)


@router.post("/agents/{agent_id}/invoke")
def invoke_agent(
    agent_id: str, body: InvokeRequest, session: SessionDep, user: UserDep
) -> InvokeResponse:
    """Runs the agent's live version on a fresh conversation and answers once
    the run stops. The status says how it stopped, as run_finished does."""
    return invoke.invoke(session, user, agent_id, body.text)
