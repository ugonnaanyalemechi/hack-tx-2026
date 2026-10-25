"""Demo agent seed flow: idempotent seeding, valid spec, cases satisfiable by the data."""

import yaml
from sqlalchemy import select

from hack_tx_2026 import eval_runner, seams
from hack_tx_2026.db.orm import Connector, ConnectorGrant
from hack_tx_2026.demo import filings
from hack_tx_2026.demo.seed_data import DEMO_EVAL_CASES, SPEC_PATH, load_spec_yaml
from hack_tx_2026.models.spec import ACCEPTED_MODEL
from hack_tx_2026.seed import seed_demo

BUILDER = {"X-User-Id": "usr_builder"}

LARK = "Larkspur Widget Co."
BRAMBLE = "Bramblewood Robotics"
QUILL = "Quillfeather Freight"

# Which filings each seeded question needs, stated independently of the seed data.
LOOKUPS: dict[str, list[tuple[str, str]]] = {
    "What revenue did Larkspur Widget Co. report for 2026-Q2?": [(LARK, "2026-Q2")],
    "What was Bramblewood Robotics' net income in 2026-Q1?": [(BRAMBLE, "2026-Q1")],
    "What diluted EPS did Quillfeather Freight report for 2026-Q2?": [(QUILL, "2026-Q2")],
    "How did Larkspur Widget Co.'s revenue change from 2026-Q1 to 2026-Q2?": [
        (LARK, "2026-Q1"),
        (LARK, "2026-Q2"),
    ],
    "What full-year revenue guidance did Quillfeather Freight give in its 2026-Q2 filing?": [
        (QUILL, "2026-Q2")
    ],
    "Summarize Bramblewood Robotics' 2026-Q2 filing.": [(BRAMBLE, "2026-Q2")],
}


class FakeGrader:
    def grade(self, *, question: str, answer: str, rubric: str) -> bool:
        return True


def seeded_agent(db_session, times: int = 1) -> str:
    agent_id = ""
    for _ in range(times):
        agent_id = seed_demo(db_session)
    return agent_id


def fake_filings_runtime(monkeypatch) -> list[bool]:
    found: list[bool] = []

    def run_agent(agent_version_id, entry_point, run_input):
        parts = []
        citations = []
        for company, quarter in LOOKUPS[run_input.message]:
            result = filings.lookup_filing(company, quarter)
            found.append(result["found"])
            f = result["filing"]
            parts.append(
                f"{f['company']} {f['quarter']}: revenue {f['revenue']}, "
                f"net income {f['net_income']}, diluted EPS {f['diluted_eps']}, "
                f"full-year revenue guidance {f['full_year_revenue_guidance']}. "
                f"{f['highlights']} (source: {result['citation']})"
            )
            citations.append({"filing_id": result["citation"]})
        return seams.RunResult(
            run_id="run_fake",
            status="completed",
            output={"text": " ".join(parts), "citations": citations},
        )

    monkeypatch.setattr(seams, "run_agent", run_agent)
    return found


def deploy(client, agent_id: str):
    return client.post(f"/v1/agents/{agent_id}/versions/1/deploy", headers=BUILDER)


def test_seeding_twice_is_idempotent(client, db_session):
    agent_id = seeded_agent(db_session, times=2)

    items = client.get("/v1/agents", headers=BUILDER).json()["items"]
    assert len(items) == 1
    (item,) = items
    assert item["id"] == agent_id
    assert item["slug"] == "filings-analyst"
    assert item["owner_id"] == "usr_builder"
    assert item["latest_version_number"] == 1
    assert item["live_version_number"] is None

    detail = client.get(f"/v1/agents/{agent_id}", headers=BUILDER).json()
    assert [(v["version_number"], v["status"]) for v in detail["versions"]] == [(1, "draft")]

    cases = client.get(f"/v1/agents/{agent_id}/eval-cases", headers=BUILDER).json()["items"]
    assert len(cases) == 6
    assert {c["origin"] for c in cases} == {"manual"}
    assert len({c["question"] for c in cases}) == 6

    users = client.get("/v1/users").json()
    assert {u["id"] for u in users} == {
        "usr_admin",
        "usr_builder",
        "usr_builder_2",
        "usr_end_user",
    }


def test_connector_and_grant_seeded_once(client, db_session):
    # DB-level on purpose: there is no connector HTTP endpoint yet (ticket #14).
    agent_id = seeded_agent(db_session, times=2)
    db_session.expire_all()
    (connector,) = db_session.scalars(select(Connector)).all()
    assert connector.name == filings.CONNECTOR_NAME
    assert connector.tools == filings.TOOL_DEFS
    grants = db_session.scalars(
        select(ConnectorGrant).where(ConnectorGrant.revoked_at.is_(None))
    ).all()
    assert len(grants) == 1
    assert grants[0].agent_id == agent_id
    assert grants[0].connector_id == connector.id
    assert grants[0].granted_by == "usr_admin"


def test_spec_file_validates_and_matches_connector(client, db_session):
    r = client.post("/v1/agents/validate", json={"spec_yaml": load_spec_yaml()}, headers=BUILDER)
    assert r.status_code == 200
    assert r.json() == {"valid": True, "errors": []}
    assert yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))["slug"] == "filings-analyst"

    agent_id = seeded_agent(db_session)
    spec = client.get(f"/v1/agents/{agent_id}", headers=BUILDER).json()["versions"][0]["spec"]
    assert spec["model"] == ACCEPTED_MODEL
    (conn,) = spec["connectors"]
    assert conn["name"] == filings.CONNECTOR_NAME
    assert {"lookup_filing", "save_note"} <= set(conn["allow_list"])
    assert conn["side_effect_tools"] == ["save_note"]


def test_cases_are_satisfiable_and_demo_deploys(client, db_session, monkeypatch):
    agent_id = seeded_agent(db_session)
    assert {c["question"] for c in DEMO_EVAL_CASES} == set(LOOKUPS)
    found = fake_filings_runtime(monkeypatch)
    monkeypatch.setattr(eval_runner, "rubric_grader", FakeGrader())

    r = deploy(client, agent_id)
    assert r.status_code == 200
    body = r.json()
    assert found and all(found)
    report = body["eval_report"]
    assert report["passed"] is True
    assert report["score"] == 1.0
    assert report["threshold"] == 0.8
    assert len(report["per_case_results"]) == 6
    assert all(c["passed"] for c in report["per_case_results"])
    assert body["live_version_number"] == 1
    assert body["versions"][0]["status"] == "deployed"


def test_gate_still_passes_without_rubric_grader(client, db_session, monkeypatch):
    agent_id = seeded_agent(db_session)
    fake_filings_runtime(monkeypatch)
    body = deploy(client, agent_id).json()
    assert body["eval_report"]["score"] == 5 / 6
    assert body["eval_report"]["passed"] is True
    assert body["live_version_number"] == 1
