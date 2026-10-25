"""Invoke layer (ticket #20): one non-streaming call runs an agent's live
version and answers with JSON once the run stops. Writes runs.

An invoke is the same run as a chat message: it goes through
`agent_runtime.stream_chat` with entry_point "api", and the response is
built from that run's stream events. So whatever the runtime streams
(guard notes, an approval request, a budget pause, an error) shows up here
without invoke-specific code.

Each invoke is a fresh conversation with no thread. Its graph memory is
checkpointed under the run's id, so a run that stops for an approval or a
budget pause can be resumed with `Command(resume=...)` on the run id.
"""

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session

from hack_tx_2026 import agent_runtime, seams
from hack_tx_2026.db.orm import Agent, Run
from hack_tx_2026.errors import ApiError
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.events import (
    ApprovalRequiredEvent,
    ErrorEvent,
    GuardNoteEvent,
    MessageCompleteEvent,
    RunFinishedEvent,
)
from hack_tx_2026.models.invoke_api import InvokeApproval, InvokeError, InvokeResponse


def start_invoke_run(
    session: Session, user: CurrentUser, agent_id: str
) -> tuple[Run, dict[str, Any]]:
    """Creates and commits the run on the agent's live version. Returns the
    run and the version it runs (as `seams.read_agent_version` returns it)."""
    if session.get(Agent, agent_id) is None:
        raise ApiError(404, "agent_not_found", "Agent not found")
    try:
        version = seams.read_agent_version(agent_id)
    except LookupError:
        raise ApiError(409, "no_live_version", "This agent has no live version yet") from None
    run = Run(
        agent_id=agent_id,
        agent_version_id=version["agent_version_id"],
        thread_id=None,
        user_id=user.id,
        entry_point="api",
    )
    session.add(run)
    session.commit()
    return run, version


def collect(run_id: str, events: Iterable[Any]) -> InvokeResponse:
    """Folds a run's stream events into the invoke response."""
    response = InvokeResponse(run_id=run_id, status="failed")
    for event in events:
        if isinstance(event, MessageCompleteEvent):
            response.message = event.text
        elif isinstance(event, GuardNoteEvent):
            response.guard_notes.append(event.note)
        elif isinstance(event, ApprovalRequiredEvent):
            response.approval = InvokeApproval(
                approval_id=event.approval_id,
                tool_name=event.tool_name,
                tool_input=event.tool_input,
            )
        elif isinstance(event, ErrorEvent):
            response.error = InvokeError(code=event.code, message=event.message)
        elif isinstance(event, RunFinishedEvent):
            response.status = event.status
    return response


def invoke(session: Session, user: CurrentUser, agent_id: str, text: str) -> InvokeResponse:
    run, version = start_invoke_run(session, user, agent_id)
    run_id = run.id
    session.close()  # the run can take a while; don't hold a pooled connection meanwhile
    events = agent_runtime.stream_chat(
        run_id=run_id,
        thread_id=run_id,  # a fresh conversation, checkpointed under the run id
        agent_version_id=version["agent_version_id"],
        spec=version["spec"],
        text=text,
    )
    return collect(run_id, events)
