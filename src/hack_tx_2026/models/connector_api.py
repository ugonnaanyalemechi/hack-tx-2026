"""Request/response bodies for the connector endpoints (ticket #14)."""

import datetime as dt
from typing import Any

from pydantic import BaseModel


class ToolOut(BaseModel):
    name: str
    side_effect: bool
    description: str
    input_schema: dict[str, Any]


class ConnectorOut(BaseModel):
    id: str
    name: str
    description: str
    tools: list[ToolOut]


class GrantRequest(BaseModel):
    agent_id: str


class GrantOut(BaseModel):
    id: str
    connector_id: str
    agent_id: str
    granted_by: str
    granted_at: dt.datetime
    revoked_at: dt.datetime | None
