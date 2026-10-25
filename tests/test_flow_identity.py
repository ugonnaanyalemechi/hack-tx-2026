"""Identity flow: seeded users, the role-switcher list, and header identity."""

import pytest

from hack_tx_2026.seed import seed_users

SEEDED = {
    "usr_admin": "admin",
    "usr_builder": "builder",
    "usr_builder_2": "builder",
    "usr_end_user": "end_user",
}


def test_users_listed_without_identity_header(client) -> None:
    response = client.get("/v1/users")

    assert response.status_code == 200
    assert {u["id"]: u["role"] for u in response.json()} == SEEDED
    assert all(u["name"] for u in response.json())


def test_seeding_twice_does_not_duplicate(client, db_session) -> None:
    seed_users(db_session)
    seed_users(db_session)

    assert len(client.get("/v1/users").json()) == 4


@pytest.mark.parametrize("user_id,role", SEEDED.items())
def test_me_accepts_each_seeded_user(client, user_id, role) -> None:
    response = client.get("/v1/me", headers={"X-User-Id": user_id})

    assert response.status_code == 200
    assert response.json()["id"] == user_id
    assert response.json()["role"] == role


def test_missing_header_is_rejected(client) -> None:
    response = client.get("/v1/me")

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "missing_identity"
    assert body["error"]["message"]


def test_unknown_user_is_rejected(client) -> None:
    response = client.get("/v1/me", headers={"X-User-Id": "usr_nobody"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unknown_user"


def test_unknown_route_uses_shared_error_shape(client) -> None:
    response = client.get("/v1/nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
