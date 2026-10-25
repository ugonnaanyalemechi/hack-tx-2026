"""Identity: the caller's identity comes from a header naming a seeded user
(see docs: spec, API contracts). No real login for the MVP."""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from hack_tx_2026.db.base import get_session
from hack_tx_2026.db.orm import User
from hack_tx_2026.settings import get_settings


def current_user(request: Request, db: Session = Depends(get_session)) -> User:
    header_name = get_settings().identity_header_name
    user_id = request.headers.get(header_name)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "missing_identity_header",
                    "message": f"The {header_name} header is required.",
                    "details": None,
                }
            },
        )

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "code": "unknown_user",
                    "message": f"No seeded user with id {user_id!r}.",
                    "details": None,
                }
            },
        )
    return user
