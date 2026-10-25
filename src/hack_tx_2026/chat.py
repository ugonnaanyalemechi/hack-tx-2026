"""Chat layer: threads and the runs a message starts. Writes threads and runs.

A thread belongs to the user who created it: only they can read it or post
to it. Functions flush or commit as noted; the stream itself is
`agent_runtime.stream_chat`.
"""

import datetime as dt
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from hack_tx_2026 import agent_runtime, seams
from hack_tx_2026.admin_reads import _b64, _unb64, _utc
from hack_tx_2026.db.orm import Agent, AgentVersion, Approval, Run, Thread
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.api import Page
from hack_tx_2026.models.chat_api import MessageOut, ThreadOut

TITLE_LENGTH = 60


def _thread_out(thread: Thread) -> ThreadOut:
    return ThreadOut(
        id=thread.id,
        agent_id=thread.agent_id,
        title=thread.title,
        created_at=_utc(thread.created_at),
        last_updated_at=_utc(thread.last_updated_at),
    )


def _agent(session: Session, agent_id: str) -> Agent:
    agent = session.get(Agent, agent_id)
    if agent is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    return agent


def create_thread(session: Session, user: CurrentUser, agent_id: str) -> ThreadOut:
    _agent(session, agent_id)
    thread = Thread(agent_id=agent_id, owner_id=user.id)
    session.add(thread)
    session.commit()
    return _thread_out(thread)


def _cursor(cursor: str) -> tuple[dt.datetime, str]:
    try:
        stamp, thread_id = _unb64(cursor).split("|", 1)
        return _utc(dt.datetime.fromisoformat(stamp)), thread_id
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


def list_threads(
    session: Session, user: CurrentUser, agent_id: str, limit: int, cursor: str | None
) -> Page[ThreadOut]:
    """The caller's own threads with the agent, most recently active first."""
    _agent(session, agent_id)
    stmt = (
        select(Thread)
        .where(Thread.agent_id == agent_id, Thread.owner_id == user.id)
        .order_by(Thread.last_updated_at.desc(), Thread.id.desc())
        .limit(limit + 1)
    )
    if cursor:
        stamp, thread_id = _cursor(cursor)
        stmt = stmt.where(
            or_(
                Thread.last_updated_at < stamp,
                and_(Thread.last_updated_at == stamp, Thread.id < thread_id),
            )
        )
    rows = list(session.scalars(stmt))
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = page[-1]
        next_cursor = _b64(f"{_utc(last.last_updated_at).isoformat()}|{last.id}")
    return Page[ThreadOut](items=[_thread_out(t) for t in page], next_cursor=next_cursor)


def owned_thread(session: Session, user: CurrentUser, thread_id: str) -> Thread:
    """The thread, if the caller owns it: 404 if unknown, 403 if someone else's."""
    thread = session.get(Thread, thread_id)
    if thread is None:
        raise ApiError(404, "thread_not_found", "Thread not found")
    if thread.owner_id != user.id:
        raise ApiError(403, "forbidden", "This thread belongs to someone else")
    return thread


def read_messages(thread: Thread) -> list[MessageOut]:
    return [
        MessageOut(
            role=entry["role"],  # type: ignore[arg-type]
            text=entry["text"],
            created_at=dt.datetime.fromisoformat(entry["created_at"]),
        )
        for entry in agent_runtime.read_transcript(thread.id)
    ]


def start_chat_run(
    session: Session, user: CurrentUser, thread: Thread, text: str
) -> tuple[Run, dict[str, Any]]:
    """Creates the run for a new message on the agent's live version, titles
    an untitled thread with the message, and commits both. Returns the run
    and the version it runs (as `seams.read_agent_version` returns it)."""
    try:
        version = seams.read_agent_version(thread.agent_id)
    except LookupError:
        raise ApiError(409, "no_live_version", "This agent has no live version yet") from None
    run = Run(
        agent_id=thread.agent_id,
        agent_version_id=version["agent_version_id"],
        thread_id=thread.id,
        user_id=user.id,
        entry_point="chat",
    )
    session.add(run)
    if not thread.title:
        thread.title = text.strip()[:TITLE_LENGTH]
    thread.last_updated_at = dt.datetime.now(dt.UTC)
    session.commit()
    return run, version


# --- Approvals (ticket #24) ---


def ensure_no_pending_approval(session: Session, thread: Thread) -> None:
    """409 approval_pending while a run on the thread waits on a decision."""
    pending = session.scalar(
        select(Approval.id)
        .join(Run, Run.id == Approval.run_id)
        .where(Run.thread_id == thread.id, Approval.status == "pending")
        .limit(1)
    )
    if pending is not None:
        raise ApiError(409, "approval_pending", "Approve or reject the pending action first")


def decidable_approval(session: Session, user: CurrentUser, approval_id: str) -> Approval:
    """The pending approval, locked until the decision commits: 404 if unknown,
    403 unless the caller is the run's user, 409 if already decided."""
    approval = session.scalar(
        select(Approval).where(Approval.id == approval_id).with_for_update()
    )
    if approval is None:
        raise ApiError(404, "approval_not_found", "Approval not found")
    run = session.get(Run, approval.run_id)
    if run is None or run.user_id != user.id:
        raise ApiError(403, "forbidden", "Only the person running this chat can decide")
    if approval.status != "pending":
        raise ApiError(409, "approval_already_decided", "This action was already decided")
    return approval


def decide_approval(
    session: Session, user: CurrentUser, approval: Approval, decision: str
) -> tuple[Run, dict[str, Any]]:
    """Records who decided and when, marks the run running again, and commits.
    Returns the run and the spec of the version it runs."""
    run = session.get(Run, approval.run_id)
    assert run is not None
    approval.status = "approved" if decision == "approve" else "rejected"
    approval.decided_by = user.id
    approval.decided_at = dt.datetime.now(dt.UTC)
    run.status = "running"
    run.finished_at = None
    version = session.get(AgentVersion, run.agent_version_id)
    assert version is not None
    spec = dict(version.spec)
    session.commit()
    return run, spec
