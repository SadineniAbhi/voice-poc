"""Onboarding CRUD for the node graph — desingdoc.pdf §1 (Onboarding / Registration of
Routable Agents), adapted to a single self-referential Node type instead of separate
Router/Agent/Destination entities (see plan.md). No auth: anyone who can reach the backend
can edit the graph.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.db import get_db
from backend.models import Node, NodeEdge
from backend.schemas import (
    EdgeCreate,
    EdgeOut,
    GraphOut,
    NodeCreate,
    NodeDetailOut,
    NodeOut,
    NodeUpdate,
)

router = APIRouter(prefix="/api", tags=["nodes"])


async def _get_node_or_404(db: AsyncSession, node_id: uuid.UUID) -> Node:
    obj = await db.get(Node, node_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return obj


async def _get_node_detail_or_404(db: AsyncSession, node_id: uuid.UUID) -> Node:
    result = await db.execute(
        select(Node)
        .where(Node.node_id == node_id)
        .options(selectinload(Node.outgoing_edges).selectinload(NodeEdge.child))
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Node not found")
    return obj


# ---- Nodes --------------------------------------------------------------------


@router.post("/nodes", response_model=NodeOut, status_code=201)
async def create_node(body: NodeCreate, db: AsyncSession = Depends(get_db)) -> Node:
    obj = Node(**body.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.get("/nodes", response_model=list[NodeOut])
async def list_nodes(db: AsyncSession = Depends(get_db)) -> list[Node]:
    result = await db.execute(select(Node).order_by(Node.created_at))
    return list(result.scalars().all())


@router.get("/nodes/{node_id}", response_model=NodeDetailOut)
async def get_node(node_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Node:
    return await _get_node_detail_or_404(db, node_id)


@router.put("/nodes/{node_id}", response_model=NodeOut)
async def update_node(
    node_id: uuid.UUID, body: NodeUpdate, db: AsyncSession = Depends(get_db)
) -> Node:
    obj = await _get_node_or_404(db, node_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/nodes/{node_id}", status_code=204)
async def delete_node(node_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await _get_node_or_404(db, node_id)
    # Edges where this node is parent (relationship cascade) or child (ondelete=CASCADE at
    # the DB level) are both cleaned up automatically.
    await db.delete(obj)
    await db.commit()


# ---- Edges (a node's routables) ------------------------------------------------


@router.post("/nodes/{node_id}/edges", response_model=EdgeOut, status_code=201)
async def create_edge(
    node_id: uuid.UUID, body: EdgeCreate, db: AsyncSession = Depends(get_db)
) -> NodeEdge:
    if body.child_node_id == node_id:
        raise HTTPException(status_code=400, detail="A node cannot route to itself")
    await _get_node_or_404(db, node_id)
    await _get_node_or_404(db, body.child_node_id)

    obj = NodeEdge(parent_node_id=node_id, child_node_id=body.child_node_id, is_fallback=body.is_fallback)
    db.add(obj)
    await db.commit()

    result = await db.execute(
        select(NodeEdge).where(NodeEdge.edge_id == obj.edge_id).options(selectinload(NodeEdge.child))
    )
    return result.scalar_one()


@router.put("/edges/{edge_id}", response_model=EdgeOut)
async def update_edge(
    edge_id: uuid.UUID, is_fallback: bool, db: AsyncSession = Depends(get_db)
) -> NodeEdge:
    result = await db.execute(
        select(NodeEdge).where(NodeEdge.edge_id == edge_id).options(selectinload(NodeEdge.child))
    )
    obj = result.scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="Edge not found")
    obj.is_fallback = is_fallback
    await db.commit()
    await db.refresh(obj, attribute_names=["is_fallback"])
    return obj


@router.delete("/edges/{edge_id}", status_code=204)
async def delete_edge(edge_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    obj = await db.get(NodeEdge, edge_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Edge not found")
    await db.delete(obj)
    await db.commit()


# ---- Whole graph, for the canvas ------------------------------------------------


@router.get("/graph", response_model=GraphOut)
async def get_graph(db: AsyncSession = Depends(get_db)) -> GraphOut:
    nodes_result = await db.execute(select(Node).order_by(Node.created_at))
    edges_result = await db.execute(
        select(NodeEdge).options(selectinload(NodeEdge.child)).order_by(NodeEdge.created_at)
    )
    return GraphOut(nodes=list(nodes_result.scalars().all()), edges=list(edges_result.scalars().all()))
