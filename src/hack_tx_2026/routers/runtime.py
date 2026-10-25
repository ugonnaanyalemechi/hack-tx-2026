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
from hack_tx_2026.db.orm import Thread
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.chat_api import MessageOut, SendMessageRequest, ThreadOut
from hack_tx_2026.models.events import StreamEvent

router = APIRouter(prefix="/v1", tags=["runtime"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]

_EVENT = TypeAdapter(StreamEvent)


def get_owned_thread(thread_id: str, session: SessionDep, user: UserDep) -> Thread:
    return chat.owned_thread(session, user, thread_id)


OwnedThreadDep = Annotated[Thread, Depends(get_owned_thread)]


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
    body: SendMessageRequest, thread: OwnedThreadDep, session: SessionDep, user: UserDep
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
