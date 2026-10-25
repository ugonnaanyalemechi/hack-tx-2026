"""Seeded users with fixed ids (identity is a header, not a login), plus the demo agent seed."""

import argparse

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from hack_tx_2026 import registry
from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.db.orm import Agent, Connector, ConnectorGrant, EvalCase, User
from hack_tx_2026.demo import filings
from hack_tx_2026.demo.seed_data import DEMO_EVAL_CASES, load_spec_yaml
from hack_tx_2026.eval_cases import create_eval_case
from hack_tx_2026.identity import CurrentUser
from hack_tx_2026.models.evals import DeployResponse

SEEDED_USERS: list[dict[str, str]] = [
    {"id": "usr_admin", "name": "Ada Admin", "role": "admin"},
    {"id": "usr_builder", "name": "Ben Builder", "role": "builder"},
    {"id": "usr_builder_2", "name": "Cleo Builder", "role": "builder"},
    {"id": "usr_end_user", "name": "Eli End User", "role": "end_user"},
]


def seed_users(session: Session) -> None:
    """Insert any missing seeded users. Safe to call repeatedly."""
    existing = {row[0] for row in session.query(User.id).all()}
    for spec in SEEDED_USERS:
        if spec["id"] not in existing:
            session.add(User(**spec))
    session.commit()


DEMO_SLUG = "filings-analyst"
DEMO_OWNER = CurrentUser(id="usr_builder", name="Ben Builder", role="builder")


def seed_demo(session: Session) -> str:
    """Seed the demo agent, its connector, grant and eval cases; returns the agent id.

    Idempotent. Leaves version 1 as a draft: deploying goes through the real
    eval gate (see `deploy_demo`), so the seed never fabricates an eval report.
    """
    seed_users(session)

    agent = session.scalar(select(Agent).where(Agent.slug == DEMO_SLUG))
    agent_id = (
        agent.id if agent else registry.create_agent(session, DEMO_OWNER, load_spec_yaml()).id
    )

    connector = session.scalar(select(Connector).where(Connector.name == filings.CONNECTOR_NAME))
    if connector is None:
        connector = Connector(
            name=filings.CONNECTOR_NAME,
            description=filings.CONNECTOR_DESCRIPTION,
            tools=filings.TOOL_DEFS,
        )
        session.add(connector)
        session.flush()

    has_grant = session.scalar(
        select(ConnectorGrant.id).where(
            ConnectorGrant.connector_id == connector.id,
            ConnectorGrant.agent_id == agent_id,
            ConnectorGrant.revoked_at.is_(None),
        )
    )
    if has_grant is None:
        session.add(
            ConnectorGrant(connector_id=connector.id, agent_id=agent_id, granted_by="usr_admin")
        )

    existing = set(session.scalars(select(EvalCase.question).where(EvalCase.agent_id == agent_id)))
    for case in DEMO_EVAL_CASES:
        if case["question"] not in existing:
            create_eval_case(session, agent_id=agent_id, origin="manual", **case)

    session.commit()
    return agent_id


def deploy_demo(session: Session, agent_id: str) -> DeployResponse | None:
    """Deploy version 1 through the real eval gate. None if the agent is already live."""
    agent = session.get(Agent, agent_id)
    if agent is None or agent.live_version_id is not None:
        return None
    response = registry.deploy_version(session, DEMO_OWNER, agent_id, 1)
    session.commit()
    return response


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Seed users and the demo filings-analyst agent.")
    parser.add_argument(
        "--deploy", action="store_true", help="also deploy version 1 through the eval gate"
    )
    args = parser.parse_args(argv)

    with SessionLocal() as session:
        agent_id = seed_demo(session)
        detail = registry.get_agent_detail(session, agent_id)
        versions = ", ".join(f"v{v.version_number} {v.status}" for v in detail.versions)
        cases = session.scalar(
            select(func.count()).select_from(EvalCase).where(EvalCase.agent_id == agent_id)
        )
        print(f"Agent: {detail.slug} ({agent_id}), owner {detail.owner_id}")
        print(f"Versions: {versions}")
        print(f"Connector: {filings.CONNECTOR_NAME} (granted by usr_admin)")
        print(f"Eval cases: {cases}")
        if not args.deploy:
            return
        response = deploy_demo(session, agent_id)
        if response is None:
            print("Deploy skipped: the agent already has a live version.")
            return
        report = response.eval_report
        if report is not None:
            print(
                f"Eval: score {report.score} / threshold {report.threshold}, passed {report.passed}"
            )
        if response.live_version_number is not None:
            print(f"Version {response.live_version_number} is LIVE.")
        else:
            print("Version 1 was BLOCKED by the eval gate.")
            print(
                "Real-runtime evals need owner:runtime's run_agent (ticket #26). "
                "An admin can override a blocked deploy with a reason."
            )
