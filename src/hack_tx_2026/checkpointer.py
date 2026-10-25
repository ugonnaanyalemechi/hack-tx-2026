"""Thread memory: LangGraph's sync Postgres checkpointer, one saved thread per chat.

The checkpoint tables (checkpoints, checkpoint_blobs, checkpoint_writes,
checkpoint_migrations) live in the app database and are created by
`PostgresSaver.setup()`, not by Alembic. The saver sits on a connection pool
so several chats can run at once.

Callers take the process-wide saver from `get_checkpointer()`; tests install
one over the test database with `set_checkpointer()`.
"""

import threading
from typing import Any

import sqlalchemy
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from hack_tx_2026.settings import get_settings


class PooledSaver(PostgresSaver):
    """A PostgresSaver that owns its connection pool and can close it."""

    def __init__(self, pool: ConnectionPool) -> None:
        super().__init__(pool)  # type: ignore[arg-type]
        self._pool = pool

    def close(self) -> None:
        self._pool.close()


def _libpq_url(database_url: str | sqlalchemy.URL) -> str:
    """The SQLAlchemy URL (postgresql+psycopg://...) as a plain libpq URL."""
    url = sqlalchemy.make_url(database_url).set(drivername="postgresql")
    return url.render_as_string(hide_password=False)


def open_checkpointer(database_url: str | sqlalchemy.URL, max_size: int = 10) -> PooledSaver:
    """Opens a saver over `database_url` and creates its tables if missing."""
    kwargs: dict[str, Any] = {"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row}
    pool = ConnectionPool(_libpq_url(database_url), max_size=max_size, kwargs=kwargs, open=True)
    saver = PooledSaver(pool)
    saver.setup()
    return saver


_installed: PooledSaver | None = None
_lock = threading.Lock()


def get_checkpointer() -> PooledSaver:
    """The process-wide saver over the app database.

    The app opens it at start-up (see `app.lifespan`). Code outside the app
    gets it opened on first use; the lock makes concurrent first callers
    share one saver instead of each opening a pool.
    """
    global _installed
    with _lock:
        if _installed is None:
            _installed = open_checkpointer(get_settings().database_url)
        return _installed


def set_checkpointer(saver: PooledSaver | None) -> None:
    """Install the process-wide saver (tests install one over the test database)."""
    global _installed
    with _lock:
        _installed = saver


def close_checkpointer() -> None:
    """Closes the process-wide saver, if one is open, so the next use starts fresh."""
    global _installed
    with _lock:
        saver, _installed = _installed, None
    if saver is not None:
        saver.close()
