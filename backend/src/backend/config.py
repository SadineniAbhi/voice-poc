"""Backend configuration.

POC settings only — no secrets management, no per-environment profiles.
Values are read from process env / a `.env` file in `backend/`.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres, e.g. postgresql+asyncpg://postgres:postgres@localhost:5432/routerpoc
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/routerpoc"

    # OpenAI Realtime
    openai_api_key: str = ""
    openai_realtime_model: str = "gpt-realtime"
    openai_voice: str = "alloy"

    # WebRTC — STUN only, no TURN, by design (see plan.md)
    stun_url: str = "stun:stun.l.google.com:19302"

    # No auth in this POC — wide open CORS for local dev.
    cors_origins: list[str] = ["*"]


settings = Settings()
