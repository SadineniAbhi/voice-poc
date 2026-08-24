"""The two endpoints that drive the actual call:

- POST /api/session       — start a call at any node, build its context, mint an OpenAI
                             ephemeral session (desingdoc.pdf §2, §3).
- POST /api/session/route — resolve the node the model routed to and mint a *brand new*
                             ephemeral session for it, seeded with a model-authored summary
                             of the conversation so far (desingdoc.pdf §4, §5) — there is no
                             shared conversation history across nodes, unlike an in-place
                             `session.update`. Works identically whether that node is a leaf
                             or itself has further routables — see agent.py.

Neither endpoint touches audio — see plan.md for why the browser talks to OpenAI directly.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.agent import build_node_context
from backend.config import settings
from backend.db import get_db
from backend.models import Node, NodeEdge
from backend.openai_client import OpenAIRealtimeError, mint_ephemeral_session
from backend.schemas import (
    REALTIME_VOICES,
    ConfigOut,
    SessionRouteRequest,
    SessionRouteResponse,
    SessionStartRequest,
    SessionStartResponse,
)

router = APIRouter(prefix="/api", tags=["voice"])


async def _load_node_with_children(db: AsyncSession, node_id) -> Node | None:
    result = await db.execute(
        select(Node)
        .where(Node.node_id == node_id)
        .options(selectinload(Node.outgoing_edges).selectinload(NodeEdge.child))
    )
    return result.scalar_one_or_none()


async def _mint_session_for_node(
    node: Node, is_transfer: bool, summary: str | None = None
) -> SessionStartResponse:
    context = build_node_context(node, node.outgoing_edges, is_transfer=is_transfer, summary=summary)
    try:
        session = await mint_ephemeral_session(context.instructions, context.tools, context.voice)
    except OpenAIRealtimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return SessionStartResponse(
        client_secret=session["value"],
        expires_at=session.get("expires_at"),
        model=settings.openai_realtime_model,
        node=node,
        children=[e.child for e in node.outgoing_edges],
        opening_instructions=context.opening_instructions,
    )


@router.get("/config", response_model=ConfigOut)
async def get_config() -> ConfigOut:
    return ConfigOut(stun_url=settings.stun_url, voices=REALTIME_VOICES)


@router.post("/session", response_model=SessionStartResponse)
async def start_session(
    body: SessionStartRequest, db: AsyncSession = Depends(get_db)
) -> SessionStartResponse:
    node = await _load_node_with_children(db, body.node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return await _mint_session_for_node(node, is_transfer=False)


@router.post("/session/route", response_model=SessionRouteResponse)
async def route_session(
    body: SessionRouteRequest, db: AsyncSession = Depends(get_db)
) -> SessionRouteResponse:
    current = await _load_node_with_children(db, body.current_node_id)
    if current is None:
        raise HTTPException(status_code=404, detail="current_node_id not found")

    # Trust, but verify: the model is only supposed to call route_call with an id from its
    # own tool enum, but that's a soft constraint enforced by the prompt/schema — actually
    # check the requested node is one of the current node's own outgoing edges before
    # honoring it, rather than relying on the model having obeyed instructions.
    valid_child_ids = {e.child_node_id for e in current.outgoing_edges}
    if body.node_id not in valid_child_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                f"'{body.node_id}' is not a connection of the current node "
                f"('{current.name}'). It must be one of this node's own routables."
            ),
        )

    node = await _load_node_with_children(db, body.node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")

    return await _mint_session_for_node(node, is_transfer=True, summary=body.summary)
