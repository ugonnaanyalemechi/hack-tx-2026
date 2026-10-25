"""Migration tooling test: Alembic autogenerate must leave LangGraph's tables alone.

This goes below the HTTP API on purpose; the seam is the `include_object` filter that
migrations/env.py hands to Alembic, exercised through Alembic's own comparison.
"""

from collections.abc import Generator
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, text

from hack_tx_2026.db import orm  # noqa: F401 — registers tables on Base.metadata
from hack_tx_2026.db.base import Base
from hack_tx_2026.db.migration_filter import include_object

CHECKPOINT_TABLES = [
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
    "checkpoint_migrations",
]


@pytest.fixture
def checkpoint_tables(test_engine: Engine, db_session) -> Generator[None]:
    with test_engine.begin() as conn:
        for name in CHECKPOINT_TABLES:
            conn.execute(text(f'CREATE TABLE "{name}" (id integer PRIMARY KEY, data text)'))
    try:
        yield
    finally:
        with test_engine.begin() as conn:
            for name in CHECKPOINT_TABLES:
                conn.execute(text(f'DROP TABLE IF EXISTS "{name}"'))


def _flatten(ops: list[Any]) -> list[Any]:
    out: list[Any] = []
    for op in ops:
        out.extend(_flatten(op) if isinstance(op, list) else [op])
    return out


def _diff(engine: Engine) -> list[Any]:
    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"include_object": include_object})
        return _flatten(compare_metadata(context, Base.metadata))


def test_checkpoint_tables_are_not_dropped(test_engine: Engine, checkpoint_tables: None) -> None:
    dropped = {op[1].name for op in _diff(test_engine) if op[0] == "remove_table"}
    assert not dropped & set(CHECKPOINT_TABLES)


def test_changes_to_our_own_tables_are_still_detected(
    test_engine: Engine, checkpoint_tables: None
) -> None:
    with test_engine.begin() as conn:
        conn.execute(text("ALTER TABLE threads ADD COLUMN stray text"))
    assert any(op[0] == "remove_column" and op[3].name == "stray" for op in _diff(test_engine))
