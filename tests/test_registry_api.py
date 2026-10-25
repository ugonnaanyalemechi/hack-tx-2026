"""End-to-end tests for the registry endpoints (ticket #13): through the
HTTP API, checking what ends up in the database — not internal functions.
"""

import yaml

VALID_SPEC = {
    "spec_version": 1,
    "name": "Filings Analyst",
    "slug": "filings-analyst",
    "description": "Answers questions about filings.",
    "model": "gemini/gemini-3.8-flash",
    "instructions": "Answer questions using the filings connector.",
    "budget": {"monthly_cap": 50.0},
    "evals": {"min_score": 0.8},
}


def _headers(user_id: str) -> dict[str, str]:
    return {"X-User-Id": user_id}


def test_validate_accepts_a_good_spec(client) -> None:
    response = client.post("/v1/agents/validate", json={"yaml": yaml.dump(VALID_SPEC)})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "errors": []}


def test_validate_names_the_bad_field_for_a_disallowed_model(client) -> None:
    bad_spec = {**VALID_SPEC, "model": "gpt-4"}

    response = client.post("/v1/agents/validate", json={"yaml": yaml.dump(bad_spec)})

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["errors"][0]["field"] == "model"


def test_validate_names_the_bad_field_for_a_non_empty_trigger(client) -> None:
    bad_spec = {**VALID_SPEC, "trigger": "daily"}

    response = client.post("/v1/agents/validate", json={"yaml": yaml.dump(bad_spec)})

    body = response.json()
    assert body["valid"] is False
    assert body["errors"][0]["field"] == "trigger"


def test_create_requires_identity_header(client) -> None:
    response = client.post("/v1/agents", json={"yaml": yaml.dump(VALID_SPEC)})

    assert response.status_code == 401


def test_create_then_list_then_read(client) -> None:
    create = client.post(
        "/v1/agents", json={"yaml": yaml.dump(VALID_SPEC)}, headers=_headers("usr_builder")
    )
    assert create.status_code == 201
    agent = create.json()
    assert agent["slug"] == "filings-analyst"
    assert agent["owner_id"] == "usr_builder"
    assert agent["live_version_id"] is None

    listed = client.get("/v1/agents").json()
    assert [a["id"] for a in listed] == [agent["id"]]

    detail = client.get(f"/v1/agents/{agent['id']}").json()
    assert len(detail["versions"]) == 1
    assert detail["versions"][0] == {
        "id": detail["versions"][0]["id"],
        "version_number": 1,
        "status": "draft",
        "created_at": detail["versions"][0]["created_at"],
    }


def test_only_owner_can_add_a_version_everyone_else_copies(client) -> None:
    agent = client.post(
        "/v1/agents", json={"yaml": yaml.dump(VALID_SPEC)}, headers=_headers("usr_builder")
    ).json()

    forbidden = client.post(
        f"/v1/agents/{agent['id']}/versions",
        json={"yaml": yaml.dump(VALID_SPEC)},
        headers=_headers("usr_admin"),
    )
    assert forbidden.status_code == 403

    owner_version = client.post(
        f"/v1/agents/{agent['id']}/versions",
        json={"yaml": yaml.dump({**VALID_SPEC, "description": "v2"})},
        headers=_headers("usr_builder"),
    )
    assert owner_version.status_code == 201
    assert owner_version.json()["version_number"] == 2

    copy = client.post(
        f"/v1/agents/{agent['id']}/copy",
        json={"slug": "filings-analyst-copy"},
        headers=_headers("usr_admin"),
    )
    assert copy.status_code == 201
    assert copy.json()["owner_id"] == "usr_admin"
    assert copy.json()["slug"] == "filings-analyst-copy"


def test_deploy_without_the_eval_gate_makes_a_version_live(client) -> None:
    agent = client.post(
        "/v1/agents", json={"yaml": yaml.dump(VALID_SPEC)}, headers=_headers("usr_builder")
    ).json()

    deploy = client.post(
        f"/v1/agents/{agent['id']}/versions/1/deploy", headers=_headers("usr_builder")
    )
    assert deploy.status_code == 200
    assert deploy.json()["status"] == "deployed"

    read_back = client.get(f"/v1/agents/{agent['id']}").json()
    assert read_back["live_version_id"] == deploy.json()["id"]


def test_seeded_users_are_selectable_through_the_identity_header(client) -> None:
    users = client.get("/v1/users").json()

    roles = {u["role"] for u in users}
    assert roles == {"admin", "builder", "end_user"}
