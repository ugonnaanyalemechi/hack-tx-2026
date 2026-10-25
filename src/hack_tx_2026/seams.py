"""The seams between owner:platform and owner:runtime.

Platform owns and implements load_agent_tools, check_agent_budget,
create_ticket and read_agent_version; runtime calls them. run_agent is
owned by runtime (its behavior is runtime's); platform's eval runner calls
it. All bodies here are placeholders until the owning ticket lands —
callers should only rely on the signatures below.
"""

from typing import Any, Protocol

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
    from hack_tx_2026.connectors import load_agent_tools as _load_agent_tools
    from hack_tx_2026.db.base import SessionLocal

    session = SessionLocal()
    try:
        return list(_load_agent_tools(session, agent_version_id))
    finally:
        session.close()


def check_agent_budget(agent_id: str) -> BudgetStatus:
    """Owned by platform (budget service). Called by the model gateway
    before each call."""
    raise NotImplementedError("owner:platform — budget service, ticket #21")


def create_ticket(run_id: str, question: str, answer: str, created_by: str) -> str:
    """Owned by platform. Called by runtime when an answer is flagged.
    Returns the new ticket's id."""
    raise NotImplementedError("owner:platform — tickets, ticket #29")


def read_agent_version(agent_id: str, version_number: int | None = None) -> dict[str, Any]:
    """Owned by platform (registry). Returns the live version when
    version_number is omitted."""
    raise NotImplementedError("owner:platform — registry, ticket #13")


def run_agent(agent_version_id: str, entry_point: EntryPoint, run_input: RunInput) -> RunResult:
    """Owned by runtime (agent runtime). Used identically by chat, the API
    address, re-checks and evals — platform's eval runner calls this."""
    raise NotImplementedError("owner:runtime — agent runtime")
