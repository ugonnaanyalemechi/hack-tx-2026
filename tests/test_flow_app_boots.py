"""The first end-to-end flow test: the pattern later flow tests copy.

Hits the HTTP API (not internal functions) and checks what ends up in the
database — see CLAUDE.md, How to work.
"""

from fastapi.testclient import TestClient

from hack_tx_2026.app import create_app
from hack_tx_2026.db.orm import User


def test_app_boots_and_responds_over_http() -> None:
    client = TestClient(create_app())

    response = client.get("/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_a_written_row_is_readable_back(db_session) -> None:
    db_session.add(User(name="Ada Builder", role="builder"))
    db_session.commit()

    user = db_session.query(User).filter_by(name="Ada Builder").one()

    assert user.id.startswith("usr_")
    assert user.role == "builder"
