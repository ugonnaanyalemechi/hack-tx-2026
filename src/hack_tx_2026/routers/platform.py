"""owner:platform's endpoints: registry, connectors/grants, budgets, evals,
admin reads, tickets, identity and seeded users. Empty until its ticket
lands — add routes here, never in app.py.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["platform"])
