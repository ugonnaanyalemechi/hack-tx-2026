"""Chat layer: threads and the runs a message starts. Writes threads and runs.

A thread belongs to the user who created it: only they can read it or post
to it. Functions flush or commit as noted; the stream itself is
`agent_runtime.stream_chat`.
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from hack_tx_2026 import agent_runtime, seams, tickets
from hack_tx_2026.cursors import b64, decode_stamp_cursor, utc
from hack_tx_2026.db.orm import Agent, AgentVersion, Approval, Run, Thread, Ticket
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
        created_at=utc(thread.created_at),
        last_updated_at=utc(thread.last_updated_at),
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
        stamp, thread_id = decode_stamp_cursor(cursor)
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
        next_cursor = b64(f"{utc(last.last_updated_at).isoformat()}|{last.id}")
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
            run_id=entry.get("run_id") if entry["role"] == "assistant" else None,
        )
        for entry in agent_runtime.read_transcript(thread.id)
    ]


def ensure_not_busy(session: Session, thread: Thread) -> None:
    """409 thread_busy while another run on the thread is still going. Two runs
    on one thread would overwrite each other's memory. Locks the thread row
    until the caller commits, so two messages arriving together can't both pass."""
    session.execute(select(Thread.id).where(Thread.id == thread.id).with_for_update())
    running = session.scalar(
        select(Run.id).where(Run.thread_id == thread.id, Run.status == "running").limit(1)
    )
    if running is not None:
        raise ApiError(409, "thread_busy", "This chat is still answering the last message")


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
    ensure_not_busy(session, thread)
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


# --- Budget pause and resume (tickets #22, #62) ---


def _paused_run(session: Session, thread: Thread, *, lock: bool = False) -> Run | None:
    """The thread's run stopped at a budget pause, waiting for Continue. With
    `lock`, the row stays locked until commit, so two Continues can't both win."""
    stmt = (
        select(Run)
        .where(Run.thread_id == thread.id, Run.status == "paused")
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    return session.scalar(stmt.with_for_update() if lock else stmt)


def _agent_budget_paused(agent_id: str) -> bool:
    try:
        return seams.check_agent_budget(agent_id).state == "paused"
    except LookupError:  # no versions yet: start_chat_run reports that
        return False


def _budget_paused_error() -> ApiError:
    return ApiError(
        409, "budget_paused", "This agent is paused at its budget cap, waiting for an admin"
    )


def ensure_not_budget_paused(session: Session, thread: Thread) -> None:
    """409 budget_paused while the agent's budget is paused, or while the
    thread has a run stopped at a budget pause that has not been continued."""
    if _paused_run(session, thread) is not None or _agent_budget_paused(thread.agent_id):
        raise _budget_paused_error()


def start_resume(session: Session, thread: Thread) -> tuple[Run, dict[str, Any]]:
    """Checks the thread's paused run may continue, marks it running again
    and commits. 409 approval_pending while an approval is pending, 409
    nothing_to_resume if no run is paused, 409 budget_paused until an admin
    approves more spend. Returns the run and its version's spec."""
    ensure_no_pending_approval(session, thread)
    run = _paused_run(session, thread, lock=True)
    if run is None:
        raise ApiError(409, "nothing_to_resume", "This chat has no paused run to continue")
    if _agent_budget_paused(thread.agent_id):
        raise _budget_paused_error()
    version = session.get(AgentVersion, run.agent_version_id)
    assert version is not None
    spec = dict(version.spec)
    run.status = "running"
    run.finished_at = None
    thread.last_updated_at = dt.datetime.now(dt.UTC)
    session.commit()
    return run, spec


def decidable_approval(session: Session, user: CurrentUser, approval_id: str) -> Approval:
    """The pending approval, locked until the decision commits: 404 if unknown,
    403 unless the caller is the run's user, 409 if already decided."""
    approval = session.scalar(select(Approval).where(Approval.id == approval_id).with_for_update())
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


@dataclass(frozen=True)
class FlagTarget:
    """A run whose answer can be flagged, with the question it answered."""

    run: Run
    question: str
    answer: str


def _ensure_not_flagged(session: Session, run: Run) -> None:
    if session.scalar(select(Ticket.id).where(Ticket.run_id == run.id)) is not None:
        raise ApiError(409, "already_flagged", "This answer has already been flagged")


def flaggable_run(session: Session, user: CurrentUser, run_id: str) -> FlagTarget:
    """The run to flag, checked before the re-check stream opens: 404 if
    unknown, 403 if it is someone else's, 409 `already_flagged` if a ticket
    exists for it, 409 `no_answer` if it never produced a final answer."""
    run = session.get(Run, run_id)
    if run is None:
        raise ApiError(404, "run_not_found", "Run not found")
    if run.user_id != user.id:
        raise ApiError(403, "forbidden", "Only the person who got this answer can flag it")
    _ensure_not_flagged(session, run)
    # A chat run's memory is its thread's; a re-check run's is its own.
    entries = agent_runtime.read_transcript(run.thread_id or run.id)
    question = next(
        (e["text"] for e in entries if e["role"] == "user" and e.get("run_id") == run.id), None
    )
    answer = next(
        (e["text"] for e in entries if e["role"] == "assistant" and e.get("run_id") == run.id),
        None,
    )
    if question is None or answer is None:
        raise ApiError(409, "no_answer", "This run has no answer to flag")
    return FlagTarget(run=run, question=question, answer=answer)


def start_recheck_run(
    session: Session, user: CurrentUser, target: FlagTarget
) -> tuple[Run, dict[str, Any]]:
    """Files the ticket for a flagged answer and creates the re-check run on
    the same agent version (no thread: it runs on fresh memory), linked to the
    ticket, all in one transaction. Commits. Returns the run and its version
    (as `seams.read_agent_version` returns it).

    The flagged run's row stays locked until the commit, so flags arriving
    together file one ticket: the others wait, then find it and get 409."""
    flagged = session.scalar(select(Run).where(Run.id == target.run.id).with_for_update())
    assert flagged is not None
    _ensure_not_flagged(session, flagged)
    version_row = session.get(AgentVersion, flagged.agent_version_id)
    if version_row is None:  # pragma: no cover — FK guarantees this
        raise ApiError(404, "run_not_found", "Run not found")
    version = seams.read_agent_version(flagged.agent_id, version_row.version_number)
    ticket = tickets.create_ticket(
        session,
        run_id=flagged.id,
        question=target.question,
        answer=target.answer,
        created_by=user.id,
    )
    run = Run(
        agent_id=flagged.agent_id,
        agent_version_id=flagged.agent_version_id,
        user_id=user.id,
        entry_point="recheck",
    )
    session.add(run)
    session.flush()
    tickets.attach_recheck_run(session, ticket_id=ticket.id, recheck_run_id=run.id)
    session.commit()
    return run, version
