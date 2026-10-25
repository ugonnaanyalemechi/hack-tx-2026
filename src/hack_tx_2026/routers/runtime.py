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

from hack_tx_2026 import agent_runtime, chat
from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import Approval, Thread
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

router = APIRouter(prefix="/v1", tags=["runtime"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]

_EVENT = TypeAdapter(StreamEvent)


def get_owned_thread(thread_id: str, session: SessionDep, user: UserDep) -> Thread:
    return chat.owned_thread(session, user, thread_id)


OwnedThreadDep = Annotated[Thread, Depends(get_owned_thread)]


def get_open_thread(thread: OwnedThreadDep, session: SessionDep) -> Thread:
    """The caller's thread, if no run on it is waiting on an approval."""
    chat.ensure_no_pending_approval(session, thread)
    return thread


OpenThreadDep = Annotated[Thread, Depends(get_open_thread)]


def get_decidable_approval(approval_id: str, session: SessionDep, user: UserDep) -> Approval:
    return chat.decidable_approval(session, user, approval_id)


DecidableApprovalDep = Annotated[Approval, Depends(get_decidable_approval)]


def get_flaggable_run(run_id: str, session: SessionDep, user: UserDep) -> chat.FlagTarget:
    return chat.flaggable_run(session, user, run_id)


FlaggableRunDep = Annotated[chat.FlagTarget, Depends(get_flaggable_run)]


def _sse(events: Iterator[Any]) -> Iterator[str]:
    for event in events:
        yield f"data: {_EVENT.dump_json(event).decode()}\n\n"


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
    run, version = chat.start_chat_run(session, user, thread, body.text)
    events = agent_runtime.stream_chat(
        run_id=run.id,
        thread_id=thread.id,
        agent_version_id=version["agent_version_id"],
        spec=version["spec"],
        text=body.text,
    )
    return StreamingResponse(
        _sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    return StreamingResponse(
        _sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/runs/{run_id}/flag")
def flag_run(
    body: FlagRequest, target: FlaggableRunDep, session: SessionDep, user: UserDep
) -> StreamingResponse:
    """Files a ticket for the run's answer, then streams a re-check run: the
    same agent version answering the same question on fresh memory."""
    run, version = chat.start_recheck_run(session, user, target)
    events = agent_runtime.stream_chat(
        run_id=run.id,
        thread_id=run.id,
        agent_version_id=version["agent_version_id"],
        spec=version["spec"],
        text=target.question,
    )
    return StreamingResponse(
        _sse(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
