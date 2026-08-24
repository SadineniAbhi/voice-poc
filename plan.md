# Voice Call-Router POC — WebRTC + OpenAI Realtime

## Context

`desingdoc.pdf` describes a hierarchical call-routing system: routers/destinations live in
Postgres as the source of truth, an inbound call resolves to a router, a voice agent picks a
destination from that router's list (asking clarifying questions if ambiguous), and either
transfers the call (originally via Twilio) or does in-call prompt switching to hop into a
sub-router.

For this POC we're dropping Twilio/PSTN entirely and replacing the call leg with **direct
browser WebRTC**, STUN-only (no TURN), and **no auth** anywhere. The "prompt switching by
calling the data api" line in the doc maps almost exactly onto OpenAI's Realtime API
mid-session `session.update` mechanism, so that's the voice engine (per your answers). We also
need the onboarding/admin page (doc section 1) to actually create routers & destinations, since
there's no other way to get data into Postgres. A short beep plays locally in the browser at the
moment of a route switch so the ~100–300ms backend round trip doesn't read as dead air.

Repo currently has empty scaffolds: `backend/` (uv/FastAPI-ready Python 3.12 project) and
`frontend/` (bare `package.json`, no build tool yet). Everything below is greenfield.

## Architecture

```
Browser (index.html)                       OpenAI Realtime API
  RTCPeerConnection (STUN only) ───────────────────► (audio + "oai-events" data channel)
        │  ▲
        │  │ ephemeral client_secret, instructions/tools
        ▼  │
  FastAPI backend  ──────────────────────►  Postgres (routers, destinations)
  (also serves onboarding CRUD)
```

- The browser holds the actual WebRTC media session with OpenAI directly (that's how OpenAI's
  Realtime/WebRTC transport works — ephemeral short-lived key, minted server-side, handed to the
  client). Our backend never proxies audio.
- Our backend's job: CRUD for routers/destinations, and building the system-prompt + tool
  definitions from DB rows, both at session start and on every route switch.
- "Transfer" never leaves the call: when the model calls the `route_call` tool, the frontend asks
  our backend what the new destination's persona/instructions are, plays the beep, then sends
  `session.update` + `function_call_output` + `response.create` over the *same* data channel.
  Hierarchical routing (doc §5) is just: destination_type `router` → backend loads the target
  router's destinations and returns router-level instructions/tools again, same mechanism.

### Confirmed OpenAI Realtime/WebRTC contract (verified against current docs)
- Mint ephemeral key: `POST https://api.openai.com/v1/realtime/client_secrets` with
  `Authorization: Bearer $OPENAI_API_KEY`, body
  `{"session": {"type": "realtime", "model": "gpt-realtime", "instructions": "...", "tools": [...], "audio": {"output": {"voice": "alloy"}}}}`.
  Response's `value` field is the ephemeral token (`ek_...`).
- Browser creates `RTCPeerConnection`, adds mic track, creates a data channel named
  `"oai-events"`, does `createOffer`/`setLocalDescription`, then
  `POST https://api.openai.com/v1/realtime/calls` with `Authorization: Bearer <ephemeral>`,
  `Content-Type: application/sdp`, body = raw SDP offer. Response body (text) is the SDP answer →
  `setRemoteDescription`.
- Mid-call updates: send `{"type": "session.update", "session": {"instructions": ..., "tools": ...}}`
  on the data channel; server confirms with `session.updated`.
- Tool calls surface in `response.done` → `response.output[]` items with
  `type: "function_call"`, carrying `name`, `call_id`, `arguments`. Client answers with
  `conversation.item.create` (`type: "function_call_output"`, `call_id`, `output`) then
  `{"type": "response.create"}` to resume.
- STUN-only requirement is satisfied on our side by explicitly constructing
  `new RTCPeerConnection({iceServers: [{urls: "stun:stun.l.google.com:19302"}]})` (configurable)
  and never configuring a TURN entry anywhere.

## Data model (adapted from the doc's schema — phone numbers dropped, Agents pulled out
## as a reusable entity)

Since there's no Twilio/PSTN, `phone_number`/`destination_number` were dropped entirely — dead
weight without real dialing. Voice Agents were also pulled out of `destinations` into their own
reusable `agents` table (create once, connect to any number of routers via a dropdown) instead of
re-entering name/description/capabilities/voice/greeting inline on every connection.

`agents`: `agent_id` (uuid pk), `name`, `description`, `capabilities` (text, "skills"), `voice`
(text, nullable — an OpenAI Realtime voice name, e.g. `coral`), `greeting` (text, nullable — the
first line this agent should open with), `created_at`, `updated_at`.

`routers`: `router_id` (uuid pk), `tenant_id` (uuid, nullable — kept for schema fidelity, unused
since there's no auth/multi-tenancy in this POC), `name`, `description`, `capabilities` (text —
the router's own overall skills/scope, folded into its system prompt), `created_at`, `updated_at`.

`destinations` (a **connection** from a router to an agent, an inline team, or another router):
`destination_id` (uuid pk), `router_id` (fk), `destination_type` (`agent` | `team` | `router`),
`agent_id` (fk, nullable — set for `agent`-type connections, resolved live via the relationship;
never denormalized/copied), `name`/`description`/`capabilities` (nullable, only used inline for
`team`-type connections), `target_router_id` (fk, nullable, used when type=`router`),
**`is_fallback`** (bool, default false — small addition beyond the doc, needed to implement the
doc's own "Incorrect routing" limitation: a designated fallback destination the model prefers
when nothing confidently matches), `created_at`, `updated_at`.

SQLAlchemy async models + `metadata.create_all()` on startup (no Alembic — POC-appropriate,
called out as a shortcut). `Destination.agent` is a lazy relationship, so every query path that
serializes a destination eager-loads it via `selectinload` — async SQLAlchemy can't lazy-load
outside an awaited query, so skipping this crashes serialization with `MissingGreenlet`.

## Backend (`backend/src/backend/`, FastAPI, uv-managed)

New deps: `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `asyncpg`, `pydantic-settings`, `httpx`.

- `config.py` — env settings: `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`
  (default `gpt-realtime`), `OPENAI_VOICE` (default `alloy`), `STUN_URL`, CORS origins
  (`*` by default — no auth POC).
- `db.py` — async engine/session, startup hook to create tables.
- `models.py` — `Router`, `Destination` ORM models per schema above.
- `schemas.py` — Pydantic in/out models.
- `routers_api.py` — admin CRUD: `POST/GET/PUT/DELETE /api/routers`,
  `POST/GET/PUT/DELETE /api/routers/{id}/destinations`, `PUT/DELETE /api/destinations/{id}`.
  Also `GET /api/routers` (lightweight list) used by the call-page picker.
- `agent.py` — `build_router_context(router, destinations) -> (instructions, tools)`: renders the
  doc's destination list (name/description/capabilities) into a system prompt instructing the
  model to ask clarifying questions when ambiguous and prefer the `is_fallback` destination when
  unsure, plus a single `route_call(destination_id)` function tool.
  `build_destination_context(destination) -> (instructions, tools)` for terminal `agent`/`team`
  destinations (persona = that destination's description/capabilities, no further tool).
- `openai_client.py` — thin `httpx` wrapper around `POST /v1/realtime/client_secrets`.
- `voice_api.py`:
  - `POST /api/session {router_id}` → loads router + destinations, builds context, mints
    ephemeral key, returns `{client_secret, expires_at, router, destinations}` to the browser.
  - `POST /api/session/route {destination_id}` → loads the destination; if `router`, recurses
    into `build_router_context` for the target router (hierarchical hop); if `agent`/`team`,
    returns the terminal persona context. Response: `{instructions, tools, destination_name,
    destination_type}` for the frontend to push via `session.update`.
- `main.py` — FastAPI app, permissive CORS, mounts the two routers.

## Frontend (`frontend/`, Vite + React + TypeScript, client-side routed)

`react`, `react-dom`, `react-router-dom` + Vite/TS toolchain (into existing package.json). One
SPA, two routes via `react-router-dom` (`/` call page, `/onboarding` admin page), dev-server
proxy for `/api` → `http://localhost:8000`.

- **`src/webrtc/realtimeClient.ts`**: a small class wrapping the whole OpenAI leg — builds the
  STUN-only `RTCPeerConnection`, `getUserMedia`, opens the `"oai-events"` data channel, POSTs the
  SDP offer to `/v1/realtime/calls` with the ephemeral bearer, `setRemoteDescription`. Parses
  incoming data-channel events; on `response.done` scans `output[]` for a `function_call` named
  `route_call` and surfaces `(destinationId, callId)` via a callback. Exposes
  `applyRoute(instructions, tools, callId)` which sends `session.update` →
  `conversation.item.create` (function_call_output) → `response.create`, in that order.
- **`src/webrtc/beep.ts`**: two short `OscillatorNode` tones (~150ms, Web Audio API) — no audio
  asset file needed, purely synthesized, fires the instant a switch is triggered (before the
  backend round trip even returns) so it reads as an immediate UI acknowledgement.
- **`src/pages/CallPage.tsx`** (`/`): fetches `GET /api/routers` for a picker, Call button →
  `POST /api/session` → hands the response to `realtimeClient`, wires its route-call callback to
  `POST /api/session/route` + beep + `applyRoute`. Status/transcript panel, breadcrumb
  ("Main Router → Billing"), remote `<audio>` element, Hang Up.
- **`src/pages/OnboardingPage.tsx`** (`/onboarding`): CRUD forms for Routers and, nested under a
  selected router, Destinations (name/description/capabilities/type/destination_number/
  target_router picker when type=`router`/is_fallback checkbox), calling the admin REST API.
  Simple nav link between the two pages.

## Local dev infra

- `docker-compose.yml` at repo root: single `postgres:16` service, POC creds, port 5432,
  named volume.
- `backend/.env.example` and `frontend/.env.example` documenting the vars above.
- Root or backend `README.md` update with the run sequence.

## Explicit POC boundaries (called out, not silently dropped)
- No Twilio/PSTN — `phone_number`/`destination_number` are display-only labels.
- STUN only, no TURN — calls behind strict/symmetric NATs may fail to connect; acceptable for a
  local/demo POC.
- No auth anywhere — open CORS, no login, no per-tenant isolation even though `tenant_id` exists
  in the schema.
- No automated test suite — verified via a manual end-to-end run (below); POC scope.

## Verification
1. `docker compose up -d` — Postgres up.
2. `cd backend && uv sync && uv run uvicorn backend.main:app --reload --port 8000` — confirm
   startup creates tables; smoke-test CRUD endpoints with `curl`.
3. `cd frontend && npm install && npm run dev` — Vite dev server.
4. On `onboarding.html`: create "Main Router" with destinations Billing/Sales/Support (Support
   flagged `is_fallback`), plus a nested "HR Router" (Salary/Leave/Benefits) wired in as a
   `router`-type destination on Main Router — reproduces the doc's example hierarchy.
5. On `index.html`: pick Main Router, Call, grant mic permission, say something billing-shaped —
   confirm `route_call` fires, beep plays, persona switches to Billing, conversation continues in
   the same call. Then test the HR → sub-router hop.
6. Code-review confirms only a STUN entry is ever passed to `RTCPeerConnection` and no TURN/
   Twilio code path exists anywhere.
7. **Needs `OPENAI_API_KEY` with Realtime API access from you** to actually place a live voice
   call — I'll wire everything and verify as much as possible without it (server boot, DB CRUD,
   static/type checks), but the mic→beep→switch flow needs a real key in `backend/.env` to test
   live.
