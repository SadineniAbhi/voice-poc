"""Builds the system-prompt `instructions` + `tools` (+ optional `voice`) for a Node.

Nodes are uniform (desingdoc.pdf's Router/Agent/Team distinction collapses entirely — see
plan.md): a node with outgoing edges behaves as a router — the model gets a `route_call`
tool listing its children (desingdoc.pdf §3) — and a node with none is a leaf/terminal
persona (desingdoc.pdf §4). The same function handles both, and is reused on every hop
(desingdoc.pdf §5) since a node's context only ever depends on itself + its own children,
never the whole graph.

Each hop tears down the old Realtime session and opens a brand new one (see voice_api.py) —
there is no shared conversation history across nodes. `route_call` therefore requires the
model to author a short summary of the conversation as part of the tool call itself; that
summary is the *only* context the next node's session starts with.
"""

from dataclasses import dataclass, field

from backend.models import Node, NodeEdge

ROUTE_TOOL_NAME = "route_call"


@dataclass
class AgentContext:
    instructions: str
    tools: list[dict] = field(default_factory=list)
    voice: str | None = None
    # A short, standalone instruction for forcing the model's very first turn (see
    # voice_api.py / realtimeClient.ts) — with server-side VAD the model otherwise just
    # waits silently for the caller to speak, so a "you must greet" line buried inside the
    # full `instructions` has nothing that ever triggers it. Always non-empty.
    opening_instructions: str = ""


def _child_block(edge: NodeEdge) -> str:
    child = edge.child
    lines = [f"- {child.name} (id: {child.node_id})"]
    if child.description:
        lines.append(f"  Description: {child.description}")
    if child.capabilities:
        lines.append(f"  Capabilities: {child.capabilities}")
    if edge.is_fallback:
        lines.append("  (fallback — use this if nothing else confidently matches)")
    return "\n".join(lines)


def _transfer_block(node: Node, summary: str | None) -> str:
    """Replaces the old "you have the full conversation" claim — that's no longer true
    once each hop is a fresh session. The caller-facing framing is the same either way
    (must acknowledge the handoff), but the model's actual context is now just `summary`.
    """
    handoff = f'You have just connected the caller to "{node.name}" as part of a transfer.'
    if summary:
        context_note = (
            f'Here is a summary of the conversation so far: "{summary}"\n\n'
            "Use this context — do not ask the caller to repeat anything already covered above."
        )
    else:
        context_note = (
            "No summary of the prior conversation was provided — briefly ask the caller "
            "what they need rather than assuming."
        )
    if node.greeting:
        opening = (
            f'You must begin by saying, in your own words, something like: "{node.greeting}" '
            "— then continue naturally."
        )
    else:
        opening = "You must briefly acknowledge this handoff before continuing — do not stay silent."
    return f"{handoff} {opening} {context_note}"


def build_node_context(
    node: Node, edges: list[NodeEdge], is_transfer: bool = False, summary: str | None = None
) -> AgentContext:
    if is_transfer:
        opening_instruction = _transfer_block(node, summary)
    elif node.greeting:
        opening_instruction = f'Begin the call by saying, in your own words, something like: "{node.greeting}".'
    else:
        # No configured greeting and not a transfer — still always force *something*
        # rather than leave the model waiting silently for the caller to speak first.
        opening_instruction = f'Begin the call by greeting the caller naturally as "{node.name}" and asking how you can help.'

    if not edges:
        # Leaf — a terminal persona, no further routing.
        instructions = f"""You have just been connected to "{node.name}".
{node.description or ""}
{f"Capabilities: {node.capabilities}" if node.capabilities else ""}
{opening_instruction}

Assist the caller directly. You are not a routing agent — do not attempt to transfer further.
""".strip()
        return AgentContext(
            instructions=instructions, tools=[], voice=node.voice, opening_instructions=opening_instruction
        )

    # Has routables — behaves as a router over its own children only (desingdoc.pdf §5:
    # never the whole graph at once).
    fallback = next((e for e in edges if e.is_fallback), None)
    child_list = "\n".join(_child_block(e) for e in edges)

    instructions = f"""You are a call routing voice agent for "{node.name}".
{node.description or ""}
{f"Overall skills/capabilities: {node.capabilities}" if node.capabilities else ""}
{opening_instruction}

Listen to the caller and figure out which destination below best matches what they need. When
you call the `{ROUTE_TOOL_NAME}` tool, you must also include a `summary` argument — a short
summary of the conversation so far and what the caller needs. The destination starts a brand
new session and will only ever see that summary, never the raw conversation, so make it count.
Do not read ids out loud — refer to destinations by name in natural language.

Available destinations:
{child_list}

If the caller's request is ambiguous or could match more than one destination, ask one brief
clarifying question before choosing — do not guess.
{f'If you still cannot confidently determine a match after clarifying, route to "{fallback.child.name}" as the fallback.' if fallback else "There is no fallback configured — if truly unsure, ask another clarifying question rather than guessing."}
""".strip()

    tools = [
        {
            "type": "function",
            "name": ROUTE_TOOL_NAME,
            "description": "Route the caller to the selected destination once identified.",
            "parameters": {
                "type": "object",
                "properties": {
                    "node_id": {
                        "type": "string",
                        "enum": [str(e.child_node_id) for e in edges],
                        "description": "The id of the chosen destination.",
                    },
                    "summary": {
                        "type": "string",
                        "description": (
                            "A concise summary of the conversation so far and what the caller "
                            "needs. The destination node starts a fresh session and will only "
                            "see this summary, not the raw conversation."
                        ),
                    },
                },
                "required": ["node_id", "summary"],
            },
        }
    ]
    return AgentContext(
        instructions=instructions, tools=tools, voice=node.voice, opening_instructions=opening_instruction
    )
