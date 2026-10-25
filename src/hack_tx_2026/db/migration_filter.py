"""Alembic autogenerate filter.

LangGraph's Postgres checkpointer creates its own tables in the app database. They are
not on `Base.metadata`, so without a filter autogenerate would propose dropping them,
which would wipe every saved chat thread.
"""

from typing import Any

CHECKPOINT_TABLES = frozenset(
    {"checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"}
)


def include_object(
    obj: Any, name: str | None, type_: str, reflected: bool, compare_to: Any
) -> bool:
    """Skip LangGraph's checkpoint tables (and anything hanging off them)."""
    if type_ == "table" and name in CHECKPOINT_TABLES:
        return False
    table = getattr(obj, "table", None)
    if type_ != "table" and table is not None and table.name in CHECKPOINT_TABLES:
        return False
    return True
