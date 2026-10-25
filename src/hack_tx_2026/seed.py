"""Seeded users with fixed ids (identity is a header, not a login)."""

from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import User

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
