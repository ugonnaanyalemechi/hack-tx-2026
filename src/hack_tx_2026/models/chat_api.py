"""Request/response bodies for the chat endpoints (ticket #15). The stream
itself is models/events.py."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field


class ThreadOut(BaseModel):
    id: str
    agent_id: str
    title: str
    created_at: dt.datetime
    last_updated_at: dt.datetime


class MessageOut(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    created_at: dt.datetime


class SendMessageRequest(BaseModel):
    text: str = Field(min_length=1)
