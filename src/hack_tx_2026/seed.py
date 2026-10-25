"""Seeded users for the identity header and the demo's role switcher
(see docs: spec, user story 64). Fixed, well-known ids — not the usual
random suffix — so the frontend's role switcher can hardcode them.
"""

from sqlalchemy.orm import Session

from hack_tx_2026.db.orm import User

SEEDED_USERS = [
    {"id": "usr_admin", "name": "Avery Admin", "role": "admin"},
    {"id": "usr_builder", "name": "Blair Builder", "role": "builder"},
    {"id": "usr_enduser", "name": "Eli End-User", "role": "end_user"},
]


def seed_users(session: Session) -> list[User]:
    """Idempotent: creates each seeded user if missing, leaves existing rows alone."""
    users = []
    for row in SEEDED_USERS:
        user = session.get(User, row["id"])
        if user is None:
            user = User(**row)
            session.add(user)
        users.append(user)
    session.commit()
    return users


def main() -> None:
    from hack_tx_2026.db.base import SessionLocal

    session = SessionLocal()
    try:
        users = seed_users(session)
        for user in users:
            print(f"{user.id}\t{user.role}\t{user.name}")
    finally:
        session.close()
