# Backend — Call Router POC

FastAPI + async SQLAlchemy (Postgres) + OpenAI Realtime (WebRTC). See `../plan.md` for the
full design. No auth, no TURN, no Twilio — POC only.

## Setup

```bash
cp example.env .env   # then set OPENAI_API_KEY
uv sync
```

Postgres (from repo root):

```bash
docker compose up -d
```

## Run

```bash
uv run uvicorn backend.main:app --reload --port 8000
```

Tables are created automatically on startup (no migrations in this POC). API docs at
http://localhost:8000/docs.

## Key endpoints

- `POST/GET/PUT/DELETE /api/routers`, `POST/GET/PUT/DELETE /api/routers/{id}/destinations`,
  `PUT/DELETE /api/destinations/{id}` — onboarding/admin CRUD.
- `GET /api/config` — STUN URL for the frontend.
- `POST /api/session {router_id}` — mints an OpenAI Realtime ephemeral session for a router
  (requires `OPENAI_API_KEY` with Realtime access).
- `POST /api/session/route {destination_id}` — resolves a chosen destination (terminal
  persona, or a hop into another router) for the frontend to push via `session.update`.
