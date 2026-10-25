"""The fake MCP server (see docs: spec, Testing Decisions): a read-only
lookup tool and a side-effect note tool, usable by every owner's tests —
no network, no real data source, just importable Python.

Tools take no caller identity — the connector always acts under its own
account, never the chatting user's (user story 63).
"""

CONNECTOR_NAME = "fake-mcp"

TOOL_DEFS = [
    {"name": "lookup", "side_effect": False},
    {"name": "note", "side_effect": True},
]

_notes: list[dict] = []


def lookup(query: str) -> dict:
    """Read-only: returns synthetic data, never a real source."""
    return {"result": f"[synthetic] no results for {query!r}"}


def note(text: str) -> dict:
    """Side effect: records a note against the fake MCP server's own account."""
    note_id = f"note_{len(_notes) + 1}"
    _notes.append({"id": note_id, "text": text})
    return {"status": "recorded", "note_id": note_id}


_TOOL_IMPLS = {"lookup": lookup, "note": note}


def call_tool(name: str, **kwargs: object) -> dict:
    if name not in _TOOL_IMPLS:
        raise KeyError(f"The fake MCP server has no tool named {name!r}.")
    return _TOOL_IMPLS[name](**kwargs)  # type: ignore[call-arg]
