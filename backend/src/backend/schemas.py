"""Pydantic request/response models for the node-graph CRUD and voice session APIs."""

import uuid

from pydantic import BaseModel, ConfigDict, model_validator

# Voices OpenAI's Realtime API currently accepts for `audio.output.voice`.
REALTIME_VOICES = [
    "alloy",
    "ash",
    "ballad",
    "coral",
    "echo",
    "sage",
    "shimmer",
    "verse",
    "marin",
    "cedar",
]


class NodeCreate(BaseModel):
    name: str
    description: str | None = None
    capabilities: str | None = None
    voice: str | None = None
    greeting: str | None = None


class NodeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    capabilities: str | None = None
    voice: str | None = None
    greeting: str | None = None


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    node_id: uuid.UUID
    name: str
    description: str | None
    capabilities: str | None
    voice: str | None
    greeting: str | None


class EdgeCreate(BaseModel):
    child_node_id: uuid.UUID
    is_fallback: bool = False


class EdgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    edge_id: uuid.UUID
    parent_node_id: uuid.UUID
    child_node_id: uuid.UUID
    is_fallback: bool
    child: NodeOut


class NodeDetailOut(NodeOut):
    outgoing_edges: list[EdgeOut] = []
    is_leaf: bool = True

    @model_validator(mode="after")
    def _compute_is_leaf(self) -> "NodeDetailOut":
        self.is_leaf = len(self.outgoing_edges) == 0
        return self


class GraphOut(BaseModel):
    """Everything the graphical canvas needs in one call."""

    nodes: list[NodeOut]
    edges: list[EdgeOut]


class SessionStartRequest(BaseModel):
    node_id: uuid.UUID


class SessionStartResponse(BaseModel):
    client_secret: str
    expires_at: int | None
    model: str
    node: NodeOut
    children: list[NodeOut]
    # Sent as a per-response `instructions` override on a forced response.create the
    # instant the connection opens — see realtimeClient.ts. That's what actually makes
    # the greeting happen; the same text is also folded into `instructions` for context
    # but that alone has nothing that triggers the model to speak first.
    opening_instructions: str


class SessionRouteRequest(BaseModel):
    node_id: uuid.UUID
    # The node the call is actually at right now — required so the backend can verify
    # `node_id` is really one of *this* node's own outgoing edges before trusting it,
    # instead of relying solely on the model having obeyed the tool's enum/system prompt.
    current_node_id: uuid.UUID
    # Model-authored summary of the conversation so far — the new node's session starts
    # fresh (no shared history, see plan.md) and only ever sees this, not the raw transcript.
    summary: str


# A route hop mints a brand new ephemeral session, same shape as starting one fresh.
SessionRouteResponse = SessionStartResponse


class ConfigOut(BaseModel):
    stun_url: str
    voices: list[str] = REALTIME_VOICES
