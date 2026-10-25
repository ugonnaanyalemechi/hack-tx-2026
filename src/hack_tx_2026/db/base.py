import datetime as dt
from collections.abc import Generator

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from hack_tx_2026.settings import get_settings


class Base(DeclarativeBase):
    # Times are UTC (see docs: spec, Data section) — store as timestamptz.
    type_annotation_map = {dt.datetime: DateTime(timezone=True)}


def make_engine(database_url: str | None = None):
    return create_engine(database_url or get_settings().database_url, future=True)


engine = make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_session() -> Generator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
