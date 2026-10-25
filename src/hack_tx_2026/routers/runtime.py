"""owner:runtime's endpoints: threads, messages, streaming, approve, resume,
invoke, flag and re-check. Empty until its ticket lands — add routes here,
never in app.py.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/v1", tags=["runtime"])
