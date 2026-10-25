from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration, read from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/app"
    test_database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/app_test"
    gemini_api_key: str = ""
    identity_header_name: str = "X-User-Id"


@lru_cache
def get_settings() -> Settings:
    return Settings()
