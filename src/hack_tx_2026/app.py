from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from hack_tx_2026.db.base import SessionLocal
from hack_tx_2026.errors import register_error_handlers
from hack_tx_2026.routers import platform, runtime
from hack_tx_2026.seed import seed_users


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    with SessionLocal() as session:
        seed_users(session)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Agent Platform", lifespan=lifespan)
    register_error_handlers(app)
    app.include_router(platform.router)
    app.include_router(runtime.router)

    @app.get("/v1/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
