"""Admin reads: catalog, run log, run detail and usage. Included by the platform router."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from hack_tx_2026 import admin_reads
from hack_tx_2026.db.base import get_session
from hack_tx_2026.identity import CurrentUser, get_current_user
from hack_tx_2026.models.admin_reads import CatalogItem, RunDetailWithApprovals, UsageReport
from hack_tx_2026.models.api import Page, RunListItem, RunListItemPublic

router = APIRouter(tags=["admin-reads"])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[CurrentUser, Depends(get_current_user)]


@router.get("/catalog")
def list_catalog(
    session: SessionDep,
    user: UserDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[CatalogItem]:
    return admin_reads.list_catalog(session, limit, cursor)


@router.get("/runs")
def list_runs(
    session: SessionDep,
    user: UserDep,
    agent_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> Page[RunListItem | RunListItemPublic]:
    return admin_reads.list_runs(session, user, agent_id, limit, cursor)


@router.get("/runs/{run_id}")
def get_run(run_id: str, session: SessionDep, user: UserDep) -> RunDetailWithApprovals:
    return admin_reads.get_run_detail(session, user, run_id)


@router.get("/usage")
def get_usage(session: SessionDep, user: UserDep, agent_id: str | None = None) -> UsageReport:
    return admin_reads.get_usage(session, user, agent_id)
