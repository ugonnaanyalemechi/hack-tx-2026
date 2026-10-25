"""Eval runner: runs an agent version's eval cases and scores them.

Each case runs through `seams.run_agent` with entry point "eval". Checks:
expected strings (case-insensitive substrings), citations, then an optional
rubric. Functions flush; callers commit.

ASSUMPTION (flag for owner:runtime): `RunResult.output` is
`{"text": str, "citations": list}`. Missing or malformed output fails the case.

Rubric grading goes through `rubric_grader`. The real grader must call the
metering model gateway; until it exists the default grader is unavailable and
rubric cases FAIL (fail-safe: the gate never passes ungraded work).
"""

from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from hack_tx_2026 import seams
from hack_tx_2026.db.orm import Agent, AgentVersion, EvalCase, EvalReport
from hack_tx_2026.eval_cases import list_eval_cases
from hack_tx_2026.models.budgets import BlockedDeployItem
from hack_tx_2026.models.evals import EvalCaseResult, EvalReportOut


class RubricGrader(Protocol):
    def grade(self, *, question: str, answer: str, rubric: str) -> bool: ...


class UnavailableRubricGrader:
    def grade(self, *, question: str, answer: str, rubric: str) -> bool:
        raise NotImplementedError("model gateway not built yet")


rubric_grader: RubricGrader = UnavailableRubricGrader()


def _run_case(case: EvalCase, version: AgentVersion, user_id: str) -> EvalCaseResult:
    result = EvalCaseResult(case_id=case.id, question=case.question, passed=False)
    try:
        run = seams.run_agent(
            version.id,
            "eval",
            seams.RunInput(thread_id=None, user_id=user_id, message=case.question),
        )
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"
        return result
    if run.status != "completed":
        result.error = f"run ended with status '{run.status}'"
        return result
    output: Any = run.output
    if not isinstance(output, dict) or not isinstance(output.get("text"), str):
        result.error = "run produced no output"
        return result
    text: str = output["text"]
    result.answer = text
    result.missing_strings = [s for s in case.expected_strings if s.lower() not in text.lower()]
    exact_ok = not result.missing_strings
    if case.citation_required:
        result.citation_ok = bool(output.get("citations"))
        exact_ok = exact_ok and result.citation_ok
    if not exact_ok:
        return result
    if case.rubric:
        try:
            result.rubric_passed = rubric_grader.grade(
                question=case.question, answer=text, rubric=case.rubric
            )
        except Exception as exc:
            result.error = f"Rubric grading unavailable: {type(exc).__name__}: {exc}"
            return result
        result.passed = result.rubric_passed
    else:
        result.passed = True
    return result


def run_evals(session: Session, version: AgentVersion, user_id: str) -> EvalReport:
    """Run every case for the version's agent and store the report.

    No cases is a vacuous pass (score 1.0).
    """
    results = [_run_case(c, version, user_id) for c in list_eval_cases(session, version.agent_id)]
    score = sum(r.passed for r in results) / len(results) if results else 1.0
    threshold = float(version.spec["evals"]["min_score"])
    report = EvalReport(
        agent_version_id=version.id,
        score=score,
        threshold=threshold,
        passed=score >= threshold,
        per_case_results=[r.model_dump(mode="json") for r in results],
    )
    session.add(report)
    session.flush()
    version.eval_report_id = report.id
    return report


def report_out(session: Session, report: EvalReport) -> EvalReportOut:
    version = session.get(AgentVersion, report.agent_version_id)
    assert version is not None
    return EvalReportOut(
        id=report.id,
        agent_id=version.agent_id,
        version_number=version.version_number,
        score=report.score,
        threshold=report.threshold,
        passed=report.passed,
        override_reason=report.override_reason,
        per_case_results=[EvalCaseResult.model_validate(r) for r in report.per_case_results],
        created_at=report.created_at,
    )


def latest_report(session: Session, agent_id: str) -> EvalReport | None:
    """The agent's most recently created report across all its versions."""
    return session.scalar(
        select(EvalReport)
        .join(AgentVersion, AgentVersion.id == EvalReport.agent_version_id)
        .where(AgentVersion.agent_id == agent_id)
        .order_by(EvalReport.created_at.desc(), EvalReport.id.desc())
        .limit(1)
    )


def blocked_deploy_items(session: Session) -> list[BlockedDeployItem]:
    rows = session.execute(
        select(Agent, AgentVersion, EvalReport)
        .join(AgentVersion, AgentVersion.agent_id == Agent.id)
        .join(EvalReport, EvalReport.id == AgentVersion.eval_report_id)
        .where(AgentVersion.status == "blocked")
        .order_by(EvalReport.created_at, EvalReport.id)
    )
    return [
        BlockedDeployItem(
            agent_id=a.id,
            agent_name=a.name,
            version_number=v.version_number,
            score=r.score,
            threshold=r.threshold,
            since=r.created_at,
        )
        for a, v, r in rows
    ]
