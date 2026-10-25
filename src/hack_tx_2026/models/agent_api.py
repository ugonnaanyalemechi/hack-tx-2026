"""Request/response bodies for the registry endpoints (ticket #13)."""

import datetime as dt

from pydantic import BaseModel


class ValidateRequest(BaseModel):
    yaml: str


class ValidateError(BaseModel):
    code: str
    message: str
    field: str | None = None


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[ValidateError] = []


class CreateAgentRequest(BaseModel):
    yaml: str


class AddVersionRequest(BaseModel):
    yaml: str


class CopyAgentRequest(BaseModel):
    slug: str
    name: str | None = None


class AgentVersionOut(BaseModel):
    id: str
    version_number: int
    status: str
    created_at: dt.datetime


class AgentOut(BaseModel):
    id: str
    slug: str
    name: str
    description: str
    owner_id: str
    live_version_id: str | None
    created_at: dt.datetime


class AgentDetailOut(AgentOut):
    versions: list[AgentVersionOut]


class UserOut(BaseModel):
    id: str
    name: str
    role: str
