"""Header-based identity: `get_current_user` resolves the caller from the DB."""

from typing import Annotated

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import User
from hack_tx_2026.errors import ApiError
from hack_tx_2026.settings import get_settings


class CurrentUser(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    role: str


def get_current_user(
    request: Request, session: Annotated[Session, Depends(get_session)]
) -> CurrentUser:
    user_id = request.headers.get(get_settings().identity_header_name)
    if not user_id:
        raise ApiError(401, "missing_identity", "Missing identity header")
    user = session.get(User, user_id)
    if user is None:
        raise ApiError(401, "unknown_user", "Unknown user")
    return CurrentUser(id=user.id, name=user.name, role=user.role)
