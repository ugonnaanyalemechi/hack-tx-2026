"""Registry flow: validate, create, version, copy, deploy and list agent specs."""

import yaml

from hack_tx_2026.demo.seed_data import load_spec_yaml

BUILDER = {"X-User-Id": "usr_builder"}
BUILDER_2 = {"X-User-Id": "usr_builder_2"}
ADMIN = {"X-User-Id": "usr_admin"}
END_USER = {"X-User-Id": "usr_end_user"}


def spec_dict(slug: str = "tax-helper", **overrides) -> dict:
    spec = {
        "spec_version": 1,
        "name": "Tax Helper",
        "slug": slug,
        "description": "Answers tax questions",
        "model": "gemini/gemini-3.8-flash",
        "instructions": "Be helpful and cite sources.",
        "budget": {"monthly_cap": 25.0},
        "evals": {"min_score": 0.8},
    }
    spec.update(overrides)
    return spec


def yaml_text(slug: str = "tax-helper", **overrides) -> str:
    spec = spec_dict(slug, **overrides)
    for key in [k for k, v in overrides.items() if v is ...]:
        del spec[key]
    return yaml.safe_dump(spec)


def create(slug: str = "tax-helper", headers=BUILDER, **overrides):
    return _post("/v1/agents", {"spec_yaml": yaml_text(slug, **overrides)}, headers)


def _post(client_path: str, body: dict, headers):
    return _CLIENT[0].post(client_path, json=body, headers=headers)


_CLIENT: list = []


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _bind_client(client):
    _CLIENT[:] = [client]
    yield
    _CLIENT.clear()


def get(path: str, headers=BUILDER):
    return _CLIENT[0].get(path, headers=headers)


def errors_by_field(response) -> dict[str, str]:
    return {e["field"]: e["message"] for e in response.json()["errors"]}


# --- validate ---------------------------------------------------------------


def test_validate_valid_spec() -> None:
    r = _post("/v1/agents/validate", {"spec_yaml": yaml_text()}, END_USER)

    assert r.status_code == 200
    assert r.json() == {"valid": True, "errors": []}


def test_validate_does_not_store() -> None:
    _post("/v1/agents/validate", {"spec_yaml": yaml_text()}, BUILDER)

    assert get("/v1/agents").json()["items"] == []


def test_validate_names_wrong_model() -> None:
    r = _post("/v1/agents/validate", {"spec_yaml": yaml_text(model="gpt-4")}, BUILDER)

    assert r.json()["valid"] is False
    assert "model" in errors_by_field(r)


def test_validate_rejects_non_empty_trigger() -> None:
    r = _post("/v1/agents/validate", {"spec_yaml": yaml_text(trigger="daily")}, BUILDER)

    assert "trigger" in errors_by_field(r)


def test_validate_nested_field_path() -> None:
    r = _post(
        "/v1/agents/validate",
        {"spec_yaml": yaml_text(budget={"monthly_cap": "lots"})},
        BUILDER,
    )

    assert "budget.monthly_cap" in errors_by_field(r)


def test_validate_names_missing_required_field() -> None:
    r = _post("/v1/agents/validate", {"spec_yaml": yaml_text(instructions=...)}, BUILDER)

    assert "instructions" in errors_by_field(r)


def test_validate_bad_yaml_and_non_mapping() -> None:
    bad = _post("/v1/agents/validate", {"spec_yaml": "name: [unclosed"}, BUILDER)
    scalar = _post("/v1/agents/validate", {"spec_yaml": "- a\n- b\n"}, BUILDER)

    for r in (bad, scalar):
        assert r.status_code == 200
        assert r.json()["valid"] is False
        assert r.json()["errors"][0]["message"]


def test_validate_bad_slug() -> None:
    r = _post("/v1/agents/validate", {"spec_yaml": yaml_text("Bad Slug_1")}, BUILDER)

    assert "slug" in errors_by_field(r)


def test_validate_reports_several_errors_at_once() -> None:
    r = _post(
        "/v1/agents/validate",
        {"spec_yaml": yaml_text("BAD", model="x", instructions=...)},
        BUILDER,
    )

    assert {"slug", "model", "instructions"} <= set(errors_by_field(r))


def validate(**overrides):
    return _post("/v1/agents/validate", {"spec_yaml": yaml_text(**overrides)}, BUILDER)


def test_validate_rejects_misspelled_top_level_key() -> None:
    r = validate(triger="daily")

    assert r.json()["valid"] is False
    assert "unknown field 'triger'" in errors_by_field(r)["triger"].lower()


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"connectors": [{"name": "files", "alow_list": ["read"]}]}, "connectors.0.alow_list"),
        ({"budget": {"monthly_cap": 25.0, "warn_fraction": 0.5}}, "budget.warn_fraction"),
        ({"evals": {"min_score": 0.8, "minscore": 0.1}}, "evals.minscore"),
        ({"guardrails": {"strip_secret": False}}, "guardrails.strip_secret"),
    ],
)
def test_validate_rejects_unknown_nested_key(overrides: dict, field: str) -> None:
    r = validate(**overrides)

    assert r.json()["valid"] is False
    assert field in errors_by_field(r)


@pytest.mark.parametrize("cap", [0, -5])
def test_validate_rejects_non_positive_monthly_cap(cap: float) -> None:
    r = validate(budget={"monthly_cap": cap})

    assert r.json()["valid"] is False
    assert "budget.monthly_cap" in errors_by_field(r)


@pytest.mark.parametrize("fraction", [0, -0.2, 1.01, 3])
def test_validate_rejects_warning_fraction_outside_zero_to_one(fraction: float) -> None:
    r = validate(budget={"monthly_cap": 25.0, "warning_fraction": fraction})

    assert r.json()["valid"] is False
    assert "budget.warning_fraction" in errors_by_field(r)


def test_validate_accepts_warning_fraction_of_one() -> None:
    r = validate(budget={"monthly_cap": 25.0, "warning_fraction": 1})

    assert r.json() == {"valid": True, "errors": []}


@pytest.mark.parametrize("score", [-0.1, 1.5, 7])
def test_validate_rejects_min_score_outside_zero_to_one(score: float) -> None:
    r = validate(evals={"min_score": score})

    assert r.json()["valid"] is False
    assert "evals.min_score" in errors_by_field(r)


@pytest.mark.parametrize("score", [0, 1])
def test_validate_accepts_min_score_at_bounds(score: float) -> None:
    r = validate(evals={"min_score": score})

    assert r.json() == {"valid": True, "errors": []}


def test_validate_rejects_side_effect_tool_missing_from_allow_list() -> None:
    connector = {"name": "files", "allow_list": ["read_file"], "side_effect_tools": ["delete_file"]}

    r = validate(connectors=[connector])

    assert r.json()["valid"] is False
    assert "delete_file" in errors_by_field(r)["connectors.0.side_effect_tools"]


@pytest.mark.parametrize(
    "connector",
    [
        {"name": "files", "allow_list": ["read", "save"], "side_effect_tools": ["save"]},
        {"name": "files", "side_effect_tools": ["save"]},
    ],
)
def test_validate_accepts_side_effect_tools_within_allow_list_or_without_one(
    connector: dict,
) -> None:
    r = validate(connectors=[connector])

    assert r.json() == {"valid": True, "errors": []}


# --- create / list / detail ------------------------------------------------


def test_create_makes_version_one_draft() -> None:
    r = create()

    assert r.status_code == 201
    body = r.json()
    assert body["slug"] == "tax-helper"
    assert body["name"] == "Tax Helper"
    assert body["owner_id"] == "usr_builder"
    assert body["live_version_number"] is None
    assert [(v["version_number"], v["status"]) for v in body["versions"]] == [(1, "draft")]
    assert body["versions"][0]["spec"]["slug"] == "tax-helper"
    assert body["versions"][0]["spec"]["budget"]["monthly_cap"] == 25.0
    assert "cost" not in str(body).lower()

    listed = get("/v1/agents", END_USER).json()["items"]
    assert [a["slug"] for a in listed] == ["tax-helper"]
    assert listed[0]["latest_version_number"] == 1
    assert listed[0]["live_version_number"] is None
    assert get(f"/v1/agents/{body['id']}", END_USER).json()["id"] == body["id"]


def test_create_invalid_spec_is_422_and_stores_nothing() -> None:
    r = create(model="nope")

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_spec"
    assert "model" in {e["field"] for e in r.json()["error"]["details"]["errors"]}
    assert get("/v1/agents").json()["items"] == []


def test_create_forbidden_for_end_user_and_allowed_for_admin() -> None:
    r = create(headers=END_USER)

    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden"
    assert create("admin-agent", headers=ADMIN).status_code == 201


def test_duplicate_slug_is_409() -> None:
    create()
    r = create(headers=BUILDER_2)

    assert r.status_code == 409
    assert r.json()["error"]["code"] == "slug_taken"


def test_unknown_agent_is_404() -> None:
    r = get("/v1/agents/agt_missing")

    assert r.status_code == 404
    assert r.json()["error"]["code"] == "agent_not_found"


def _agent_with_two_versions() -> str:
    agent_id = create().json()["id"]
    _post(
        f"/v1/agents/{agent_id}/versions",
        {"spec_yaml": yaml_text(budget={"monthly_cap": 40.0})},
        BUILDER,
    )
    return agent_id


def test_detail_omits_budget_for_end_user_and_non_owner_builder() -> None:
    agent_id = _agent_with_two_versions()

    for headers in (END_USER, BUILDER_2):
        r = get(f"/v1/agents/{agent_id}", headers)

        assert r.status_code == 200
        specs = [v["spec"] for v in r.json()["versions"]]
        assert len(specs) == 2
        assert all("budget" not in spec for spec in specs)


def test_detail_shows_budget_to_owner_and_admin() -> None:
    agent_id = _agent_with_two_versions()

    for headers in (BUILDER, ADMIN):
        r = get(f"/v1/agents/{agent_id}", headers)

        assert r.status_code == 200
        assert [v["spec"]["budget"] for v in r.json()["versions"]] == [
            {"monthly_cap": 25.0, "warning_fraction": 0.8},
            {"monthly_cap": 40.0, "warning_fraction": 0.8},
        ]


def test_detail_differs_only_by_budget_between_callers() -> None:
    agent_id = _agent_with_two_versions()
    full = get(f"/v1/agents/{agent_id}", BUILDER).json()
    assert get(f"/v1/agents/{agent_id}", ADMIN).json() == full

    expected = full
    for version in expected["versions"]:
        del version["spec"]["budget"]
    for headers in (END_USER, BUILDER_2):
        assert get(f"/v1/agents/{agent_id}", headers).json() == expected


def test_write_endpoints_return_budget_to_their_caller() -> None:
    agent_id = create().json()["id"]

    added = _post(
        f"/v1/agents/{agent_id}/versions",
        {"spec_yaml": yaml_text(budget={"monthly_cap": 40.0})},
        BUILDER,
    )
    deployed = _post(f"/v1/agents/{agent_id}/versions/2/deploy", {}, BUILDER)
    copied = _post(f"/v1/agents/{agent_id}/copy", {"slug": "my-copy"}, BUILDER_2)

    for r in (added, deployed):
        assert [v["spec"]["budget"]["monthly_cap"] for v in r.json()["versions"]] == [25.0, 40.0]
    assert copied.json()["versions"][0]["spec"]["budget"]["monthly_cap"] == 40.0


# --- versions ---------------------------------------------------------------


def test_owner_adds_versions_numbered_in_sequence() -> None:
    agent_id = create().json()["id"]

    v2 = _post(
        f"/v1/agents/{agent_id}/versions",
        {"spec_yaml": yaml_text(instructions="second")},
        BUILDER,
    )
    v3 = _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text()}, BUILDER)

    assert v2.status_code == 201 and v3.status_code == 201
    detail = get(f"/v1/agents/{agent_id}").json()
    assert [(v["version_number"], v["status"]) for v in detail["versions"]] == [
        (1, "draft"),
        (2, "draft"),
        (3, "draft"),
    ]
    assert detail["versions"][1]["spec"]["instructions"] == "second"
    assert get("/v1/agents").json()["items"][0]["latest_version_number"] == 3


def test_non_owner_and_admin_cannot_add_version() -> None:
    agent_id = create().json()["id"]

    for headers in (BUILDER_2, ADMIN):
        r = _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text()}, headers)
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "not_owner"
        assert "copy" in r.json()["error"]["message"].lower()
    assert len(get(f"/v1/agents/{agent_id}").json()["versions"]) == 1


def test_version_slug_must_match_agent() -> None:
    agent_id = create().json()["id"]

    r = _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text("other")}, BUILDER)

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_spec"
    assert "slug" in {e["field"] for e in r.json()["error"]["details"]["errors"]}


def test_demo_spec_creates_and_adds_a_version() -> None:
    demo_yaml = load_spec_yaml()

    created = _post("/v1/agents", {"spec_yaml": demo_yaml}, BUILDER)
    added = _post(f"/v1/agents/{created.json()['id']}/versions", {"spec_yaml": demo_yaml}, BUILDER)

    assert created.status_code == 201
    assert added.status_code == 201
    assert [v["version_number"] for v in added.json()["versions"]] == [1, 2]


def test_create_and_add_version_reject_unknown_and_out_of_range_fields() -> None:
    agent_id = create().json()["id"]
    bad = yaml_text(guardrail={"strip_secrets": False}, evals={"min_score": 7})

    created = _post("/v1/agents", {"spec_yaml": bad.replace("tax-helper", "other")}, BUILDER)
    added = _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": bad}, BUILDER)

    for r in (created, added):
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_spec"
        fields = {e["field"] for e in r.json()["error"]["details"]["errors"]}
        assert {"guardrail", "evals.min_score"} <= fields
    assert [a["slug"] for a in get("/v1/agents").json()["items"]] == ["tax-helper"]
    assert len(get(f"/v1/agents/{agent_id}").json()["versions"]) == 1


def test_version_invalid_spec_and_unknown_agent() -> None:
    agent_id = create().json()["id"]

    bad = _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text(model="x")}, BUILDER)
    missing = _post("/v1/agents/agt_missing/versions", {"spec_yaml": yaml_text()}, BUILDER)

    assert bad.status_code == 422
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "agent_not_found"


# --- copy -------------------------------------------------------------------


def test_copy_creates_new_agent_owned_by_copier() -> None:
    source = create(instructions="original").json()

    r = _post(f"/v1/agents/{source['id']}/copy", {"slug": "my-copy", "name": "My Copy"}, BUILDER_2)

    assert r.status_code == 201
    copy = r.json()
    assert copy["id"] != source["id"]
    assert copy["owner_id"] == "usr_builder_2"
    assert copy["slug"] == "my-copy" and copy["name"] == "My Copy"
    assert [(v["version_number"], v["status"]) for v in copy["versions"]] == [(1, "draft")]
    spec = copy["versions"][0]["spec"]
    assert spec["slug"] == "my-copy" and spec["instructions"] == "original"

    unchanged = get(f"/v1/agents/{source['id']}").json()
    assert unchanged["slug"] == "tax-helper" and unchanged["owner_id"] == "usr_builder"
    assert len(unchanged["versions"]) == 1


def test_copy_uses_live_version_over_latest() -> None:
    agent_id = create(instructions="live one").json()["id"]
    _post(
        f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text(instructions="newer")}, BUILDER
    )
    _post(f"/v1/agents/{agent_id}/versions/1/deploy", {}, BUILDER)

    copy = _post(f"/v1/agents/{agent_id}/copy", {"slug": "copy-live"}, ADMIN).json()

    assert copy["versions"][0]["spec"]["instructions"] == "live one"
    assert copy["name"] == "Tax Helper"


def test_copy_uses_latest_when_nothing_live() -> None:
    agent_id = create(instructions="first").json()["id"]
    _post(
        f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text(instructions="latest")}, BUILDER
    )

    copy = _post(f"/v1/agents/{agent_id}/copy", {"slug": "copy-latest"}, BUILDER_2).json()

    assert copy["versions"][0]["spec"]["instructions"] == "latest"


def test_copy_rules() -> None:
    agent_id = create().json()["id"]

    end_user = _post(f"/v1/agents/{agent_id}/copy", {"slug": "x-copy"}, END_USER)
    bad_slug = _post(f"/v1/agents/{agent_id}/copy", {"slug": "Bad Slug"}, BUILDER_2)
    taken = _post(f"/v1/agents/{agent_id}/copy", {"slug": "tax-helper"}, BUILDER_2)
    missing = _post("/v1/agents/agt_missing/copy", {"slug": "x-copy"}, BUILDER_2)

    assert end_user.status_code == 403 and end_user.json()["error"]["code"] == "forbidden"
    assert bad_slug.status_code == 422
    assert bad_slug.json()["error"]["code"] == "invalid_spec"
    assert taken.status_code == 409 and taken.json()["error"]["code"] == "slug_taken"
    assert missing.status_code == 404


# --- deploy -----------------------------------------------------------------


def test_owner_deploys_version_and_detail_shows_live() -> None:
    agent_id = create().json()["id"]
    _post(f"/v1/agents/{agent_id}/versions", {"spec_yaml": yaml_text()}, BUILDER)

    r = _post(f"/v1/agents/{agent_id}/versions/2/deploy", {}, BUILDER)

    assert r.status_code == 200
    detail = get(f"/v1/agents/{agent_id}", END_USER).json()
    assert detail["live_version_number"] == 2
    assert {v["version_number"]: v["status"] for v in detail["versions"]} == {
        1: "draft",
        2: "deployed",
    }
    assert r.json()["live_version_number"] == 2
    assert get("/v1/agents").json()["items"][0]["live_version_number"] == 2

    _post(f"/v1/agents/{agent_id}/versions/1/deploy", {}, BUILDER)
    assert get(f"/v1/agents/{agent_id}").json()["live_version_number"] == 1


def test_deploy_rules() -> None:
    agent_id = create().json()["id"]

    other = _post(f"/v1/agents/{agent_id}/versions/1/deploy", {}, BUILDER_2)
    admin = _post(f"/v1/agents/{agent_id}/versions/1/deploy", {}, ADMIN)
    missing_version = _post(f"/v1/agents/{agent_id}/versions/9/deploy", {}, BUILDER)
    missing_agent = _post("/v1/agents/agt_missing/versions/1/deploy", {}, BUILDER)

    for r in (other, admin):
        assert r.status_code == 403 and r.json()["error"]["code"] == "not_owner"
    assert missing_version.status_code == 404
    assert missing_version.json()["error"]["code"] == "version_not_found"
    assert missing_agent.json()["error"]["code"] == "agent_not_found"
    assert get(f"/v1/agents/{agent_id}").json()["live_version_number"] is None


# --- pagination and auth ----------------------------------------------------


def test_list_is_paged_by_slug() -> None:
    for slug in ("delta", "alpha", "charlie", "bravo", "echo"):
        create(slug)

    first = get("/v1/agents?limit=2").json()
    second = get(f"/v1/agents?limit=2&cursor={first['next_cursor']}").json()
    third = get(f"/v1/agents?limit=2&cursor={second['next_cursor']}").json()

    assert [a["slug"] for a in first["items"]] == ["alpha", "bravo"]
    assert [a["slug"] for a in second["items"]] == ["charlie", "delta"]
    assert [a["slug"] for a in third["items"]] == ["echo"]
    assert third["next_cursor"] is None
    assert len(get("/v1/agents").json()["items"]) == 5


def test_list_limit_bounds() -> None:
    assert get("/v1/agents?limit=0").status_code == 422
    assert get("/v1/agents?limit=101").status_code == 422


def test_unauthenticated_requests_get_401_with_error_shape() -> None:
    client = _CLIENT[0]
    agent_id = create().json()["id"]
    calls = [
        client.post("/v1/agents/validate", json={"spec_yaml": yaml_text()}),
        client.post("/v1/agents", json={"spec_yaml": yaml_text()}),
        client.post(f"/v1/agents/{agent_id}/versions", json={"spec_yaml": yaml_text()}),
        client.post(f"/v1/agents/{agent_id}/copy", json={"slug": "zzz"}),
        client.post(f"/v1/agents/{agent_id}/versions/1/deploy"),
        client.get("/v1/agents"),
        client.get(f"/v1/agents/{agent_id}"),
    ]

    for r in calls:
        assert r.status_code == 401
        assert set(r.json()) == {"error"}
        assert r.json()["error"]["code"] == "missing_identity"
