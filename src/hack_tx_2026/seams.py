"""The seams between owner:platform and owner:runtime.

Platform owns and implements load_agent_tools, check_agent_budget,
create_ticket, attach_recheck_run and read_agent_version; runtime calls them. run_agent is
owned by runtime (its behavior is runtime's); platform's eval runner calls
it. All bodies here are placeholders until the owning ticket lands —
callers should only rely on the signatures below.
"""

from typing import Any, Protocol

from sqlalchemy import select

from hack_tx_2026 import budgets, tickets
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import Agent, AgentVersion
from hack_tx_2026.models.records import EntryPoint


class Tool(Protocol):
    name: str
    side_effect: bool


class BudgetStatus:
    def __init__(self, state: str, cap: float, spent: float, extra_allowance: float):
        self.state = state  # ok | warned | paused
        self.cap = cap
        self.spent = spent
        self.extra_allowance = extra_allowance


class RunInput:
    def __init__(self, thread_id: str | None, user_id: str, message: str):
        self.thread_id = thread_id
        self.user_id = user_id
        self.message = message


class RunResult:
    def __init__(self, run_id: str, status: str, output: dict[str, Any] | None = None):
        self.run_id = run_id
        self.status = status
        self.output = output


def load_agent_tools(agent_version_id: str) -> list[Tool]:
    """Owned by platform (connector layer). Loads only tools from connectors
    granted to this agent and allowed by its spec's allow-list."""
    raise NotImplementedError("owner:platform — connector layer, ticket #14")


def check_agent_budget(agent_id: str) -> BudgetStatus:
    """Owned by platform (budget service). Called by the model gateway
    before each call. Raises LookupError if the agent has no versions."""
    with SessionLocal() as session:
        out = budgets.check_budget(session, agent_id)
        session.commit()
    return BudgetStatus(
        state=out.state,
        cap=float(out.cap),
        spent=float(out.spent),
        extra_allowance=float(out.extra_allowance),
    )


def create_ticket(run_id: str, question: str, answer: str, created_by: str) -> str:
    """Owned by platform. Called by runtime when an answer is flagged.
    Returns the new ticket's id. Raises LookupError if the run is unknown.
    Uses its own DB session."""
    with SessionLocal() as session:
        ticket = tickets.create_ticket(
            session, run_id=run_id, question=question, answer=answer, created_by=created_by
        )
        session.commit()
        return ticket.id


def attach_recheck_run(ticket_id: str, recheck_run_id: str) -> None:
    """Owned by platform. Called by runtime after the flag's re-check run
    starts, to link it to the ticket. Raises LookupError if the ticket or
    the run is unknown. Uses its own DB session."""
    with SessionLocal() as session:
        tickets.attach_recheck_run(session, ticket_id=ticket_id, recheck_run_id=recheck_run_id)
        session.commit()


def read_agent_version(agent_id: str, version_number: int | None = None) -> dict[str, Any]:
    """Owned by platform (registry). Returns the live version when
    version_number is omitted, as a dict with agent_id, agent_version_id,
    version_number, status and spec. Raises LookupError if there is no such
    agent or version (or no live version). Uses its own DB session."""
    with SessionLocal() as session:
        if version_number is None:
            agent = session.get(Agent, agent_id)
            version = session.get(AgentVersion, agent.live_version_id) if agent else None
            if version is None or version.agent_id != agent_id:
                raise LookupError(f"agent {agent_id} has no live version")
        else:
            version = session.scalar(
                select(AgentVersion).where(
                    AgentVersion.agent_id == agent_id,
                    AgentVersion.version_number == version_number,
                )
            )
            if version is None:
                raise LookupError(f"agent {agent_id} has no version {version_number}")
        return {
            "agent_id": version.agent_id,
            "agent_version_id": version.id,
            "version_number": version.version_number,
            "status": version.status,
            "spec": version.spec,
        }


def run_agent(agent_version_id: str, entry_point: EntryPoint, run_input: RunInput) -> RunResult:
    """Owned by runtime (agent runtime). Used identically by chat, the API
    address, re-checks and evals — platform's eval runner calls this."""
    raise NotImplementedError("owner:runtime — agent runtime")
