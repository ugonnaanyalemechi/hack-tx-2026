from collections.abc import Generator

import pytest
import sqlalchemy
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from hack_tx_2026.app import create_app
from hack_tx_2026.db import orm  # noqa: F401 — registers tables on Base.metadata
from hack_tx_2026.db.base import Base, get_session
from hack_tx_2026.seed import seed_users
from hack_tx_2026.settings import get_settings


def _test_db_name(url: str) -> str:
    return sqlalchemy.make_url(url).database or "app_test"


@pytest.fixture(scope="session")
def test_engine():
    settings = get_settings()
    db_name = _test_db_name(settings.test_database_url)

    maintenance_url = sqlalchemy.make_url(settings.test_database_url).set(database="postgres")
    maintenance_engine = create_engine(maintenance_url, future=True, isolation_level="AUTOCOMMIT")
    with maintenance_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": db_name},
        ).first()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    maintenance_engine.dispose()

    engine = create_engine(settings.test_database_url, future=True)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine) -> Generator[Session]:
    """Resets the test database before each test, so every test starts clean."""
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    session_factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(test_engine, db_session) -> Generator[TestClient]:
    """HTTP client over the app, wired to the freshly reset and seeded test DB.

    Send an identity with `headers={"X-User-Id": "usr_builder"}`.
    """
    session_factory = sessionmaker(bind=test_engine, autoflush=False, autocommit=False)

    def override_get_session() -> Generator[Session]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    seed_users(db_session)
    app = create_app()
    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.dependency_overrides.clear()
