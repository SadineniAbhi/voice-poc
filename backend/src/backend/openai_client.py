"""Thin wrapper around the one OpenAI REST call our backend ever makes: minting a
short-lived, pre-scoped ephemeral session for the browser to use directly against OpenAI's
Realtime WebRTC endpoint. Our real OPENAI_API_KEY never leaves this module.
"""

import httpx

from backend.config import settings

REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"


class OpenAIRealtimeError(RuntimeError):
    pass


async def mint_ephemeral_session(
    instructions: str, tools: list[dict], voice: str | None = None
) -> dict:
    if not settings.openai_api_key:
        raise OpenAIRealtimeError(
            "OPENAI_API_KEY is not set — add it to backend/.env before starting a call."
        )

    payload = {
        "session": {
            "type": "realtime",
            "model": settings.openai_realtime_model,
            "instructions": instructions,
            "tools": tools,
            "audio": {"output": {"voice": voice or settings.openai_voice}},
        }
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            REALTIME_CLIENT_SECRETS_URL,
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if resp.status_code >= 400:
        raise OpenAIRealtimeError(f"OpenAI client_secrets mint failed ({resp.status_code}): {resp.text}")
    return resp.json()
