"""Helpers shared by the paged list endpoints: opaque cursors and UTC times."""

import base64
import datetime as dt

from hack_tx_2026.db.orm import Run
from hack_tx_2026.errors import ApiError


def utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode()


def unb64(cursor: str) -> str:
    try:
        return base64.b64decode(cursor.encode(), altchars=b"-_", validate=True).decode()
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


def decode_stamp_cursor(cursor: str) -> tuple[dt.datetime, str]:
    """A cursor made of a timestamp and an id: "<iso time>|<id>", base64-encoded."""
    try:
        stamp, row_id = unb64(cursor).split("|", 1)
        return utc(dt.datetime.fromisoformat(stamp)), row_id
    except ValueError:
        raise ApiError(422, "invalid_cursor", "Cursor is not valid") from None


def db_dt(value: dt.datetime) -> dt.datetime:
    """Match the column's timezone-awareness for comparisons."""
    if Run.__table__.c.created_at.type.timezone:  # type: ignore[attr-defined]
        return value
    return value.replace(tzinfo=None)
