import { useCallback, useEffect, useState } from "react";
import ReactFlow, { Background, Controls, useEdgesState, useNodesState, type Connection } from "reactflow";
import "reactflow/dist/style.css";

import { api } from "../api";
import GraphNodeCard, { type GraphNodeData } from "../graph/GraphNode";
import { layoutGraph } from "../graph/layout";
import type { Graph } from "../types";

const nodeTypes = { graphNode: GraphNodeCard };

type Selection = { type: "node"; id: string } | { type: "edge"; id: string } | null;

const emptyForm = { name: "", description: "", capabilities: "", voice: "", greeting: "" };

export default function OnboardingPage() {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [voices, setVoices] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [form, setForm] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<GraphNodeData>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  async function reload() {
    const g = await api.getGraph();
    setGraph(g);
  }

  useEffect(() => {
    api
      .getConfig()
      .then((c) => setVoices(c.voices))
      .catch(() => {});
    reload().catch((err) => setErrorMessage(String(err)));
  }, []);

  // Rebuild react-flow's node/edge arrays whenever the server graph or selection
  // changes, but preserve any position the user has already dragged a node to.
  useEffect(() => {
    const isLeaf = (nodeId: string) => !graph.edges.some((e) => e.parent_node_id === nodeId);

    setRfNodes((current) => {
      const existing = new Map(current.map((n) => [n.id, n.position]));
      const layout = layoutGraph(graph.nodes, graph.edges);
      return graph.nodes.map((n) => ({
        id: n.node_id,
        type: "graphNode",
        position: existing.get(n.node_id) ?? layout[n.node_id] ?? { x: 0, y: 0 },
        data: {
          name: n.name,
          description: n.description,
          capabilities: n.capabilities,
          isLeaf: isLeaf(n.node_id),
          selected: selection?.type === "node" && selection.id === n.node_id,
        },
      }));
    });

    setRfEdges(
      graph.edges.map((e) => ({
        id: e.edge_id,
        source: e.parent_node_id,
        target: e.child_node_id,
        animated: e.is_fallback,
        label: e.is_fallback ? "fallback" : undefined,
        style: {
          stroke: e.is_fallback ? "#f0b43c" : "#7c8cff",
          strokeWidth: selection?.type === "edge" && selection.id === e.edge_id ? 3 : 1.5,
        },
      }))
    );
    // graph + selection are the only inputs that should trigger a rebuild — setRfNodes /
    // setRfEdges are stable setters from useNodesState/useEdgesState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selection]);

  useEffect(() => {
    if (selection?.type !== "node") return;
    const n = graph.nodes.find((x) => x.node_id === selection.id);
    if (n) {
      setForm({
        name: n.name,
        description: n.description ?? "",
        capabilities: n.capabilities ?? "",
        voice: n.voice ?? "",
        greeting: n.greeting ?? "",
      });
    }
  }, [selection, graph.nodes]);

  const selectedEdge =
    selection?.type === "edge" ? graph.edges.find((e) => e.edge_id === selection.id) : null;

  const onConnect = useCallback(async (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setErrorMessage(null);
    try {
      await api.createEdge(connection.source, connection.target);
      await reload();
    } catch (err) {
      setErrorMessage(String(err));
    }
  }, []);

  async function handleAddNode() {
    setErrorMessage(null);
    try {
      const created = await api.createNode({ name: "New node" });
      await reload();
      setSelection({ type: "node", id: created.node_id });
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleSaveNode() {
    if (selection?.type !== "node") return;
    setErrorMessage(null);
    try {
      await api.updateNode(selection.id, {
        name: form.name,
        description: form.description || null,
        capabilities: form.capabilities || null,
        voice: form.voice || null,
        greeting: form.greeting || null,
      });
      await reload();
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleDeleteNode() {
    if (selection?.type !== "node") return;
    setErrorMessage(null);
    try {
      await api.deleteNode(selection.id);
      setSelection(null);
      await reload();
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleToggleFallback() {
    if (!selectedEdge) return;
    setErrorMessage(null);
    try {
      await api.setEdgeFallback(selectedEdge.edge_id, !selectedEdge.is_fallback);
      await reload();
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  async function handleDeleteEdge() {
    if (!selectedEdge) return;
    setErrorMessage(null);
    try {
      await api.deleteEdge(selectedEdge.edge_id);
      setSelection(null);
      await reload();
    } catch (err) {
      setErrorMessage(String(err));
    }
  }

  return (
    <div className="graph-page">
      <div className="graph-toolbar">
        <button onClick={handleAddNode}>+ New node</button>
        <p className="muted small">
          Drag from one node's edge to another to connect them — that connection is what makes
          the source node route calls to it. A node with no outgoing connections is an endpoint;
          one with any is a router. Click a node or connection to edit it.
        </p>
      </div>

      {errorMessage && <p className="error">{errorMessage}</p>}

      <div className="graph-layout">
        <div className="graph-canvas card">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelection({ type: "node", id: node.id })}
            onEdgeClick={(_, edge) => setSelection({ type: "edge", id: edge.id })}
            onPaneClick={() => setSelection(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} color="#232839" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="graph-panel card">
          {!selection && (
            <p className="muted">
              Select a node to edit its details, or a connection to manage it — or drag between
              nodes to create one.
            </p>
          )}

          {selection?.type === "node" && (
            <>
              <h3>Node</h3>
              <input
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <textarea
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <textarea
                placeholder="Skills / capabilities"
                value={form.capabilities}
                onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
              />
              <div className="field-row">
                <label>Voice</label>
                <select
                  value={form.voice}
                  onChange={(e) => setForm({ ...form, voice: e.target.value })}
                >
                  <option value="">(default)</option>
                  {voices.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <input
                placeholder='Greeting (e.g. "Connecting you to Billing now.")'
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
              />
              <div className="button-row">
                <button onClick={handleSaveNode}>Save</button>
                <button className="danger" onClick={handleDeleteNode}>
                  Delete
                </button>
              </div>
            </>
          )}

          {selection?.type === "edge" && selectedEdge && (
            <>
              <h3>Connection</h3>
              <p className="muted small">
                Routes to <strong>{selectedEdge.child.name}</strong>
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={selectedEdge.is_fallback}
                  onChange={handleToggleFallback}
                />
                Fallback — prefer this one when unsure
              </label>
              <div className="button-row">
                <button className="danger" onClick={handleDeleteEdge}>
                  Delete connection
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
