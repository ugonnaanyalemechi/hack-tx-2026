def main() -> None:
    import uvicorn

    uvicorn.run("hack_tx_2026.app:app", host="0.0.0.0", port=8000, reload=True)
