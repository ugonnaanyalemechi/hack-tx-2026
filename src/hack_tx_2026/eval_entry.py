"""Eval entry point (ticket #26): runs one eval case on an agent version,
the run behind `seams.run_agent`. Writes runs and approvals.

An eval run is the same run as a chat message: it goes through
`agent_runtime.stream_chat` with entry_point "eval", on a fresh conversation
checkpointed under the run's own id, and is recorded and metered like any
run. Nobody is there to approve a side effect, so each one is rejected on the
eval's user's behalf (the person who deployed) and the run resumed with
"reject", until it stops for another reason. The side-effect tool never runs.
"""

import datetime as dt
from collections.abc import Iterable
from typing import Any

from sqlalchemy import select

from hack_tx_2026 import agent_runtime, invoke, output_guard, seams
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import AgentVersion, Approval, Run
from hack_tx_2026.models.records import EntryPoint

# Side-effect calls rejected in one eval run before it is given up as failed,
# so a model that keeps retrying a declined action cannot loop forever.
MAX_REJECTIONS = 10


def _start_run(agent_version_id: str, user_id: str) -> tuple[str, dict[str, Any]]:
    """Creates and commits the eval run. Returns its id and the version's spec."""
    with SessionLocal() as session:
        version = session.get(AgentVersion, agent_version_id)
        if version is None:
            raise LookupError(f"agent version {agent_version_id} not found")
        run = Run(
            agent_id=version.agent_id,
            agent_version_id=version.id,
            thread_id=None,
            user_id=user_id,
            entry_point="eval",
        )
        session.add(run)
        session.commit()
        return run.id, dict(version.spec)


def _decide_pending(run_id: str, user_id: str, *, give_up: bool = False) -> None:
    """Rejects the run's pending approval as the eval's user. The run goes back
    to running, or, when `give_up`, ends failed with nothing left to resume."""
    with SessionLocal() as session:
        now = dt.datetime.now(dt.UTC)
        approvals = session.scalars(
            select(Approval)
            .where(Approval.run_id == run_id, Approval.status == "pending")
            .with_for_update()
        )
        for approval in approvals:
            approval.status = "rejected"
            approval.decided_by = user_id
            approval.decided_at = now
        run = session.get(Run, run_id)
        assert run is not None
        run.status = "failed" if give_up else "running"
        run.finished_at = now if give_up else None
        session.commit()


def run_eval(
    agent_version_id: str, entry_point: EntryPoint, run_input: seams.RunInput
) -> seams.RunResult:
    """Runs `run_input.message` on the version as `run_input.user_id`, with
    every side effect rejected. A completed run's output is the guarded
    answer: `{"text", "citations", "guard_notes"}`, where citations are the
    ones the guard found in the text. Raises LookupError for an unknown
    version and ValueError for an entry point other than "eval"."""
    if entry_point != "eval":
        raise ValueError(f"run_agent only runs evals, not {entry_point!r} runs")
    run_id, spec = _start_run(agent_version_id, run_input.user_id)
    common = {"run_id": run_id, "thread_id": run_id, "agent_version_id": agent_version_id}
    events: Iterable[Any] = agent_runtime.stream_chat(**common, spec=spec, text=run_input.message)
    guard_notes: list[str] = []
    rejections = 0
    while True:
        response = invoke.collect(run_id, events)
        guard_notes += response.guard_notes
        if response.status != "awaiting_approval":
            break
        if rejections == MAX_REJECTIONS:
            _decide_pending(run_id, run_input.user_id, give_up=True)
            return seams.RunResult(run_id=run_id, status="failed")
        rejections += 1
        _decide_pending(run_id, run_input.user_id)
        events = agent_runtime.stream_decision(**common, spec=spec, decision="reject")
    if response.status != "completed" or response.message is None:
        return seams.RunResult(run_id=run_id, status=response.status)
    output = {
        "text": response.message,
        "citations": output_guard.find_citations(response.message),
        "guard_notes": guard_notes,
    }
    return seams.RunResult(run_id=run_id, status=response.status, output=output)
