"""The demo connector's data and tools: fictional quarterly filings.

SYNTHETIC DATA ONLY. Every company and figure in `data/filings.json` is
invented; nothing comes from a real company or any employer.

This module is pure Python with no network or database. The connector layer
(ticket #14) serves it: `TOOL_DEFS` matches the `connectors.tools` row shape
(`[{name, side_effect}]`) and `call_tool(name, **kwargs)` mirrors the fake MCP
server's dispatcher, so the loader can route calls for the `filings-demo`
connector here.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

CONNECTOR_NAME = "filings-demo"
CONNECTOR_DESCRIPTION = (
    "Demo connector over synthetic quarterly filings of fictional companies: "
    "a read-only filing lookup and a side-effect note tool."
)

TOOL_DEFS: list[dict[str, Any]] = [
    {"name": "lookup_filing", "side_effect": False},
    {"name": "save_note", "side_effect": True},
]

DATA_PATH = Path(__file__).parent / "data" / "filings.json"

_QUARTER_RE = re.compile(r"(\d{4})\s*-?\s*q([1-4])|q([1-4])\s*-?\s*(\d{4})", re.IGNORECASE)

_notes: list[dict[str, str]] = []


@lru_cache
def load_filings() -> tuple[dict[str, Any], ...]:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return tuple(data["filings"])


def _normalize_company(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def normalize_quarter(quarter: str) -> str | None:
    """Accepts '2026-Q2', '2026Q2', 'Q2 2026' or 'q2-2026'; returns '2026-Q2'."""
    match = _QUARTER_RE.search(quarter.strip())
    if match is None:
        return None
    year = match.group(1) or match.group(4)
    q = match.group(2) or match.group(3)
    return f"{year}-Q{q}"


def _company_matches(query: str, company: str) -> bool:
    q = _normalize_company(query)
    return bool(q) and q in _normalize_company(company)


def lookup_filing(company: str, quarter: str) -> dict[str, Any]:
    """Read-only: the fictional filing for a company and quarter.

    Company matching is case-insensitive and partial ("larkspur" finds
    "Larkspur Widget Co."). Returns `{"found": True, "filing": {...},
    "citation": filing_id}` or `{"found": False, "message": ...,
    "available": [...]}` listing the filings that do exist.
    """
    wanted_quarter = normalize_quarter(quarter)
    for filing in load_filings():
        if _company_matches(company, filing["company"]) and filing["quarter"] == wanted_quarter:
            return {"found": True, "filing": dict(filing), "citation": filing["filing_id"]}
    return {
        "found": False,
        "message": f"No synthetic filing for company {company!r} and quarter {quarter!r}.",
        "available": [
            {"company": f["company"], "quarter": f["quarter"], "filing_id": f["filing_id"]}
            for f in load_filings()
        ],
    }


def save_note(text: str) -> dict[str, str]:
    """Side effect: records an analyst note under the connector's own account."""
    note_id = f"note_{len(_notes) + 1}"
    _notes.append({"id": note_id, "text": text})
    return {"status": "recorded", "note_id": note_id}


_TOOL_IMPLS: dict[str, Any] = {"lookup_filing": lookup_filing, "save_note": save_note}


def call_tool(name: str, **kwargs: Any) -> dict[str, Any]:
    if name not in _TOOL_IMPLS:
        raise KeyError(f"The {CONNECTOR_NAME} connector has no tool named {name!r}.")
    result: dict[str, Any] = _TOOL_IMPLS[name](**kwargs)
    return result
