# Call Router POC

Hierarchical voice call routing: routers/destinations live in Postgres, a browser places a
WebRTC call directly to OpenAI's Realtime API, and routing is done by swapping the live
session's instructions mid-call (no Twilio/PSTN, no TURN — STUN only, no auth). See
[`plan.md`](./plan.md) for the full design and [`desingdoc.pdf`](./desingdoc.pdf) for the
original spec this adapts.

## Run it

1. **Postgres**
   ```bash
   docker compose up -d
   ```
2. **Backend** — see [`backend/README.md`](./backend/README.md). You'll need an
   `OPENAI_API_KEY` with Realtime API access in `backend/.env` to place a live call.
   ```bash
   cd backend && cp example.env .env   # set OPENAI_API_KEY
   uv sync
   uv run uvicorn backend.main:app --reload --port 8000
   ```
3. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open the printed local URL. `/onboarding` registers routers and destinations; `/` places
   a call against a chosen router.

## Try it

On `/onboarding`, create a "Main Router" with a few destinations (mark one `is_fallback`),
plus a nested router-type destination pointing at a second router — reproduces the doc's
Main Router → HR Router → Benefits example. Then on `/`, pick the router, hit Call, and talk.
When the agent routes you, you'll hear a short beep as the persona switches mid-call.
