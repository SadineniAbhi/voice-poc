"""ORM models — a single self-referential Node graph.

Every routable thing (what used to be "Router" / "Agent" / "Team") is just a Node: it has
a name, description, capabilities, voice, and greeting. A node's outgoing edges are its
"routables" — the things it can send a call to. A node with outgoing edges behaves as a
router (the model gets a `route_call` tool listing its children); a node with none is a
leaf/endpoint persona. No separate Router/Agent/Destination types — see plan.md.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db import Base


class Node(Base):
    __tablename__ = "nodes"

    node_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    capabilities: Mapped[str | None] = mapped_column(Text, nullable=True)
    voice: Mapped[str | None] = mapped_column(Text, nullable=True)
    greeting: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    outgoing_edges: Mapped[list["NodeEdge"]] = relationship(
        "NodeEdge",
        foreign_keys="NodeEdge.parent_node_id",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="NodeEdge.created_at",
    )


class NodeEdge(Base):
    """A routable link: `parent` can route the call to `child`. `is_fallback` marks the
    child `parent` should prefer when it can't confidently pick among its routables.
    """

    __tablename__ = "node_edges"
    __table_args__ = (UniqueConstraint("parent_node_id", "child_node_id", name="uq_node_edge"),)

    edge_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    parent_node_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    child_node_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("nodes.node_id", ondelete="CASCADE"), nullable=False
    )
    is_fallback: Mapped[bool] = mapped_column(default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    parent: Mapped["Node"] = relationship(
        "Node", foreign_keys=[parent_node_id], back_populates="outgoing_edges"
    )
    child: Mapped["Node"] = relationship("Node", foreign_keys=[child_node_id])
