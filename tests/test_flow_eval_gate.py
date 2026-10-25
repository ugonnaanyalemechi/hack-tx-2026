"""Eval gate flow: eval cases, deploy gate, admin override and the blocked-deploy queue."""

from decimal import Decimal

import pytest
import yaml
from sqlalchemy import select

from hack_tx_2026 import eval_runner, seams
from hack_tx_2026.db.orm import AgentVersion, Run

BUILDER = {"X-User-Id": "usr_builder"}
BUILDER_2 = {"X-User-Id": "usr_builder_2"}
ADMIN = {"X-User-Id": "usr_admin"}
END_USER = {"X-User-Id": "usr_end_user"}


def spec_yaml(min_score: float = 0.8, slug: str = "tax-helper") -> str:
    return yaml.safe_dump(
        {
            "spec_version": 1,
            "name": "Tax Helper",
            "slug": slug,
            "description": "Answers tax questions",
            "model": "gemini/gemini-3.8-flash",
            "instructions": "Be helpful and cite sources.",
            "budget": {"monthly_cap": 10.0},
            "evals": {"min_score": min_score},
        }
    )


def create_agent(client, min_score: float = 0.8, slug: str = "tax-helper") -> str:
    r = client.post("/v1/agents", json={"spec_yaml": spec_yaml(min_score, slug)}, headers=BUILDER)
    assert r.status_code == 201
    return r.json()["id"]


def add_case(client, agent_id: str, question: str, headers=BUILDER, **fields):
    body = {"question": question, **fields}
    return client.post(f"/v1/agents/{agent_id}/eval-cases", json=body, headers=headers)


def deploy(client, agent_id: str, version: int = 1, headers=BUILDER, body=None):
    return client.post(
        f"/v1/agents/{agent_id}/versions/{version}/deploy", json=body, headers=headers
    )


def override(client, agent_id: str, reason: str, version: int = 1, headers=ADMIN):
    return deploy(client, agent_id, version, headers, {"override_reason": reason})


def report(client, agent_id: str, headers=BUILDER):
    return client.get(f"/v1/agents/{agent_id}/eval-report", headers=headers)


def queue(client) -> list[dict]:
    r = client.get("/v1/admin/queue", headers=ADMIN)
    assert r.status_code == 200
    return r.json()["items"]


def blocked_items(client) -> list[dict]:
    return [i for i in queue(client) if i["kind"] == "blocked_deploy"]


def ok(text: str, citations: list | None = None) -> dict:
    return {"text": text, "citations": citations or []}


def fake_runtime(monkeypatch, answers: dict[str, dict]):
    calls = []

    def run_agent(agent_version_id, entry_point, run_input):
        calls.append((agent_version_id, entry_point, run_input.message, run_input.user_id))
        return seams.RunResult(
            run_id="run_fake", status="completed", output=answers[run_input.message]
        )

    monkeypatch.setattr(seams, "run_agent", run_agent)
    return calls


class FakeGrader:
    def __init__(self, verdict: bool):
        self.verdict = verdict
        self.calls = 0

    def grade(self, *, question: str, answer: str, rubric: str) -> bool:
        self.calls += 1
        return self.verdict


def record_run_cost(db_session, agent_id: str, cost: str) -> None:
    """TEST SETUP ONLY: insert a finished run with a chosen cost (no run write API yet)."""
    version_id = db_session.scalar(select(AgentVersion.id).where(AgentVersion.agent_id == agent_id))
    db_session.add(
        Run(
            agent_id=agent_id,
            agent_version_id=version_id,
            user_id="usr_end_user",
            entry_point="chat",
            status="completed",
            cost_total=Decimal(cost),
        )
    )
    db_session.commit()


def blocked_agent(client, monkeypatch) -> str:
    """Agent whose v1 is blocked at 0.5 against a 0.8 threshold."""
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", expected_strings=["alpha"])
    add_case(client, agent_id, "q2", expected_strings=["beta"])
    fake_runtime(monkeypatch, {"q1": ok("alpha"), "q2": ok("nope")})
    assert deploy(client, agent_id).status_code == 200
    return agent_id


def test_case_create_and_list_permissions(client):
    agent_id = create_agent(client)
    r = add_case(client, agent_id, "What is VAT?", expected_strings=["tax"])
    assert r.status_code == 201
    body = r.json()
    assert body["origin"] == "manual"
    assert body["agent_id"] == agent_id
    assert body["expected_strings"] == ["tax"]
    assert add_case(client, agent_id, "Second", headers=ADMIN, rubric="polite").status_code == 201
    for who in (BUILDER_2, END_USER):
        assert add_case(client, agent_id, "x", headers=who, rubric="r").status_code == 403
        r = client.get(f"/v1/agents/{agent_id}/eval-cases", headers=who)
        assert r.status_code == 403
    for who in (BUILDER, ADMIN):
        r = client.get(f"/v1/agents/{agent_id}/eval-cases", headers=who)
        assert r.status_code == 200
        assert [c["question"] for c in r.json()["items"]] == ["What is VAT?", "Second"]


def test_case_unknown_agent_and_empty_case(client):
    r = add_case(client, "agt_missing", "q", rubric="r")
    assert r.status_code == 404
    assert "agent_not_found" in r.text
    assert client.get("/v1/agents/agt_missing/eval-cases", headers=BUILDER).status_code == 404
    agent_id = create_agent(client)
    for body in (
        {"question": "q"},
        {"question": "q", "expected_strings": ["  "], "rubric": "  "},
        {"question": "  ", "rubric": "r"},
    ):
        r = client.post(f"/v1/agents/{agent_id}/eval-cases", json=body, headers=BUILDER)
        assert r.status_code == 422
        assert "empty_eval_case" in r.text


def test_deploy_without_cases_passes_vacuously(client):
    agent_id = create_agent(client)
    r = deploy(client, agent_id)
    assert r.status_code == 200
    body = r.json()
    assert body["live_version_number"] == 1
    assert body["versions"][0]["status"] == "deployed"
    assert body["eval_report"]["score"] == 1.0
    assert body["eval_report"]["passed"] is True
    assert body["eval_report"]["per_case_results"] == []
    assert report(client, agent_id).json()["id"] == body["eval_report"]["id"]


def test_deploy_runs_all_cases_and_stores_report(client, monkeypatch):
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", expected_strings=["alpha"])
    add_case(client, agent_id, "q2", expected_strings=["BETA"], citation_required=True)
    calls = fake_runtime(
        monkeypatch, {"q1": ok("Alpha is first"), "q2": ok("beta!", [{"url": "x"}])}
    )
    r = deploy(client, agent_id)
    assert r.status_code == 200
    assert r.json()["live_version_number"] == 1
    assert sorted(c[2] for c in calls) == ["q1", "q2"]
    assert {c[1] for c in calls} == {"eval"}
    assert {c[3] for c in calls} == {"usr_builder"}
    rep = report(client, agent_id).json()
    assert rep["score"] == 1.0 and rep["passed"] is True and rep["threshold"] == 0.8
    assert rep["version_number"] == 1 and rep["agent_id"] == agent_id
    assert [c["passed"] for c in rep["per_case_results"]] == [True, True]
    assert rep["per_case_results"][1]["citation_ok"] is True
    assert report(client, agent_id, ADMIN).status_code == 200
    assert report(client, agent_id, END_USER).status_code == 403


def test_report_not_found_and_unknown_agent(client):
    agent_id = create_agent(client)
    r = report(client, agent_id)
    assert r.status_code == 404
    assert "eval_report_not_found" in r.text
    assert report(client, "agt_missing").status_code == 404


def test_failures_missing_strings_and_citations(client, monkeypatch):
    agent_id = create_agent(client, min_score=1.0)
    add_case(client, agent_id, "q1", expected_strings=["alpha", "beta", "gamma"])
    add_case(client, agent_id, "q2", citation_required=True)
    fake_runtime(monkeypatch, {"q1": ok("ALPHA only"), "q2": ok("no cites")})
    r = deploy(client, agent_id)
    assert r.status_code == 200
    results = {c["question"]: c for c in r.json()["eval_report"]["per_case_results"]}
    assert results["q1"]["passed"] is False
    assert results["q1"]["missing_strings"] == ["beta", "gamma"]
    assert results["q2"]["passed"] is False
    assert results["q2"]["citation_ok"] is False
    assert r.json()["eval_report"]["score"] == 0.0


def test_under_threshold_blocks_and_queues(client, monkeypatch):
    agent_id = blocked_agent(client, monkeypatch)
    r = client.get(f"/v1/agents/{agent_id}", headers=BUILDER).json()
    assert r["live_version_number"] is None
    assert r["versions"][0]["status"] == "blocked"
    rep = report(client, agent_id).json()
    assert rep["score"] == 0.5 and rep["passed"] is False
    (item,) = blocked_items(client)
    assert item["agent_id"] == agent_id
    assert item["agent_name"] == "Tax Helper"
    assert item["version_number"] == 1
    assert item["score"] == 0.5 and item["threshold"] == 0.8
    assert item["since"]


def test_failed_gate_keeps_previous_live_version(client, monkeypatch):
    agent_id = create_agent(client)
    assert deploy(client, agent_id).json()["live_version_number"] == 1
    client.post(f"/v1/agents/{agent_id}/versions", json={"spec_yaml": spec_yaml()}, headers=BUILDER)
    add_case(client, agent_id, "q1", expected_strings=["alpha"])
    fake_runtime(monkeypatch, {"q1": ok("nope")})
    r = deploy(client, agent_id, 2)
    assert r.json()["live_version_number"] == 1
    assert r.json()["versions"][1]["status"] == "blocked"


def test_queue_mixes_budget_pause_and_blocked(client, monkeypatch, db_session):
    agent_id = blocked_agent(client, monkeypatch)
    record_run_cost(db_session, agent_id, "10.00")
    kinds = sorted(i["kind"] for i in queue(client))
    assert kinds == ["blocked_deploy", "budget_pause"]


def test_runtime_stub_blocks_without_crashing(client):
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", expected_strings=["alpha"])
    r = deploy(client, agent_id)
    assert r.status_code == 200
    assert r.json()["versions"][0]["status"] == "blocked"
    (case,) = r.json()["eval_report"]["per_case_results"]
    assert case["passed"] is False
    assert "NotImplementedError" in case["error"]


def test_non_completed_run_or_no_output_fails_case(client, monkeypatch):
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", expected_strings=["a"])
    add_case(client, agent_id, "q2", expected_strings=["a"])

    def run_agent(agent_version_id, entry_point, run_input):
        if run_input.message == "q1":
            return seams.RunResult(run_id="r", status="failed", output=None)
        return seams.RunResult(run_id="r", status="completed", output=None)

    monkeypatch.setattr(seams, "run_agent", run_agent)
    results = deploy(client, agent_id).json()["eval_report"]["per_case_results"]
    assert all(c["passed"] is False and c["error"] for c in results)
    assert "failed" in results[0]["error"]


def test_rubric_grading(client, monkeypatch):
    agent_id = create_agent(client, min_score=1.0)
    add_case(client, agent_id, "q1", rubric="Be polite")
    fake_runtime(monkeypatch, {"q1": ok("hello")})
    grader = FakeGrader(True)
    monkeypatch.setattr(eval_runner, "rubric_grader", grader)
    r = deploy(client, agent_id)
    assert r.json()["eval_report"]["passed"] is True
    assert r.json()["eval_report"]["per_case_results"][0]["rubric_passed"] is True
    assert grader.calls == 1

    client.post(f"/v1/agents/{agent_id}/versions", json={"spec_yaml": spec_yaml()}, headers=BUILDER)
    monkeypatch.setattr(eval_runner, "rubric_grader", FakeGrader(False))
    r = deploy(client, agent_id, 2)
    assert r.json()["eval_report"]["passed"] is False
    assert r.json()["eval_report"]["per_case_results"][0]["rubric_passed"] is False


def test_rubric_unavailable_fails_safe(client, monkeypatch):
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", rubric="Be polite")
    fake_runtime(monkeypatch, {"q1": ok("hello")})
    r = deploy(client, agent_id)
    assert r.status_code == 200
    assert r.json()["versions"][0]["status"] == "blocked"
    (case,) = r.json()["eval_report"]["per_case_results"]
    assert case["rubric_passed"] is None
    assert "rubric grading unavailable" in case["error"].lower()


def test_rubric_not_graded_when_exact_checks_fail(client, monkeypatch):
    agent_id = create_agent(client)
    add_case(client, agent_id, "q1", expected_strings=["alpha"], rubric="Be polite")
    fake_runtime(monkeypatch, {"q1": ok("hello")})
    grader = FakeGrader(True)
    monkeypatch.setattr(eval_runner, "rubric_grader", grader)
    r = deploy(client, agent_id)
    assert r.json()["eval_report"]["passed"] is False
    assert grader.calls == 0


def test_override_rules(client, monkeypatch):
    agent_id = blocked_agent(client, monkeypatch)
    r = override(client, agent_id, "ship it", headers=BUILDER)
    assert r.status_code == 403
    assert "forbidden" in r.text
    for reason in ("", "   "):
        r = override(client, agent_id, reason)
        assert r.status_code == 422
        assert "override_reason_required" in r.text
    assert override(client, agent_id, "x", version=9).status_code == 404

    healthy = create_agent(client, slug="other-helper")
    r = override(client, healthy, "why not")
    assert r.status_code == 409
    assert "version_not_blocked" in r.text


def test_admin_override_deploys_blocked_version(client, monkeypatch):
    agent_id = blocked_agent(client, monkeypatch)
    r = override(client, agent_id, "  Accepted risk  ")
    assert r.status_code == 200
    assert r.json()["live_version_number"] == 1
    assert r.json()["versions"][0]["status"] == "deployed"
    assert r.json()["versions"][0]["spec"]["budget"]["monthly_cap"] == 10.0
    assert r.json()["eval_report"]["override_reason"] == "Accepted risk"
    rep = report(client, agent_id, ADMIN).json()
    assert rep["override_reason"] == "Accepted risk"
    assert rep["passed"] is False
    assert blocked_items(client) == []


def test_owner_redeploy_after_fix_clears_queue(client, monkeypatch):
    agent_id = blocked_agent(client, monkeypatch)
    assert len(blocked_items(client)) == 1
    fake_runtime(monkeypatch, {"q1": ok("alpha"), "q2": ok("beta")})
    r = deploy(client, agent_id)
    assert r.json()["versions"][0]["status"] == "deployed"
    assert r.json()["live_version_number"] == 1
    assert blocked_items(client) == []


def test_deploy_still_owner_only(client):
    agent_id = create_agent(client)
    assert deploy(client, agent_id, headers=BUILDER_2).status_code == 403
    assert deploy(client, agent_id, headers=ADMIN).status_code == 403
    assert deploy(client, agent_id, 9).status_code == 404
    assert deploy(client, "agt_missing").status_code == 404
    assert deploy(client, agent_id, body={}).status_code == 200


@pytest.mark.parametrize("path", ["eval-cases", "eval-report"])
def test_end_user_cannot_read(client, path):
    agent_id = create_agent(client)
    r = client.get(f"/v1/agents/{agent_id}/{path}", headers=END_USER)
    assert r.status_code == 403
