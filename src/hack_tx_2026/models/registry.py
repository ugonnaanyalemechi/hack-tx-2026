"""Request/response bodies for the agent registry endpoints."""

import datetime as dt

from pydantic import BaseModel

from hack_tx_2026.models.api import Page


class SpecYamlRequest(BaseModel):
    spec_yaml: str


class CopyRequest(BaseModel):
    slug: str
    name: str | None = None


class SpecError(BaseModel):
    field: str
    message: str


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[SpecError]


class AgentListItem(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    owner_id: str
    live_version_number: int | None
    latest_version_number: int | None


class AgentVersionOut(BaseModel):
    version_number: int
    status: str
    created_at: dt.datetime
    spec: dict


class AgentDetail(AgentListItem):
    versions: list[AgentVersionOut]


AgentPage = Page[AgentListItem]
