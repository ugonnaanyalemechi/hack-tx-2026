"""The fake MCP server needs no app, no database and no fixtures — any
owner's tests can import and call it directly."""

import pytest

from hack_tx_2026 import fake_mcp


def test_lookup_is_read_only_and_synthetic() -> None:
    result = fake_mcp.call_tool("lookup", query="revenue 2025")

    assert "revenue 2025" in result["result"]


def test_note_is_a_side_effect_tool_that_takes_no_caller_identity() -> None:
    """Both calls below are indistinguishable to the tool: it never sees
    who is asking, only its own account (user story 63)."""
    first = fake_mcp.call_tool("note", text="flagged answer looked wrong")
    second = fake_mcp.call_tool("note", text="another note")

    assert first["status"] == "recorded"
    assert first["note_id"] != second["note_id"]


def test_unknown_tool_raises() -> None:
    with pytest.raises(KeyError):
        fake_mcp.call_tool("delete_everything")


def test_tool_defs_match_their_implementations() -> None:
    names = {tool["name"] for tool in fake_mcp.TOOL_DEFS}

    assert names == {"lookup", "note"}
    assert {t["name"]: t["side_effect"] for t in fake_mcp.TOOL_DEFS} == {
        "lookup": False,
        "note": True,
    }
