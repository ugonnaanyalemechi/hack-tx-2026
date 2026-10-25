"""Seed content for the demo agent: its spec file and its manual eval cases.

SYNTHETIC DATA ONLY. The expected strings match `data/filings.json`.
"""

from pathlib import Path
from typing import Any

SPEC_PATH = Path(__file__).parent / "filings_analyst.yaml"


def load_spec_yaml() -> str:
    return SPEC_PATH.read_text(encoding="utf-8")


DEMO_EVAL_CASES: list[dict[str, Any]] = [
    {
        "question": "What revenue did Larkspur Widget Co. report for 2026-Q2?",
        "expected_strings": ["$48.2 million"],
        "citation_required": True,
    },
    {
        "question": "What was Bramblewood Robotics' net income in 2026-Q1?",
        "expected_strings": ["$2.4 million", "net loss"],
        "citation_required": True,
    },
    {
        "question": "What diluted EPS did Quillfeather Freight report for 2026-Q2?",
        "expected_strings": ["$0.87"],
        "citation_required": True,
    },
    {
        "question": "How did Larkspur Widget Co.'s revenue change from 2026-Q1 to 2026-Q2?",
        "expected_strings": ["$41.5 million", "$48.2 million"],
        "citation_required": True,
    },
    {
        "question": (
            "What full-year revenue guidance did Quillfeather Freight give in its 2026-Q2 filing?"
        ),
        "expected_strings": ["$310 million"],
        "citation_required": True,
    },
    {
        "question": "Summarize Bramblewood Robotics' 2026-Q2 filing.",
        "expected_strings": ["$15.9 million"],
        "citation_required": True,
        "rubric": (
            "Mentions the quarter's revenue and that the company still reported a net loss, "
            "cites the filing, and does not invent figures that are not in the filing."
        ),
    },
]
