from fastapi import FastAPI

from hack_tx_2026.routers import platform, runtime


def create_app() -> FastAPI:
    app = FastAPI(title="Agent Platform")
    app.include_router(platform.router)
    app.include_router(runtime.router)

    @app.get("/v1/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
