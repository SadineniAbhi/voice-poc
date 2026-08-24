import type {
  AppConfig,
  Graph,
  GraphEdge,
  GraphNode,
  NodeDetail,
  SessionRouteResponse,
  SessionStartResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text();
    // FastAPI error responses are {"detail": "..."} — surface just that when present,
    // rather than the raw JSON, since this message can end up read by the model too
    // (see rejectRoute in realtimeClient.ts).
    let message = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) message = parsed.detail;
    } catch {
      // not JSON — use the raw body as-is
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface NodeUpsertBody {
  name: string;
  description?: string | null;
  capabilities?: string | null;
  voice?: string | null;
  greeting?: string | null;
}

export const api = {
  getConfig: () => request<AppConfig>("/config"),

  getGraph: () => request<Graph>("/graph"),
  listNodes: () => request<GraphNode[]>("/nodes"),
  getNode: (nodeId: string) => request<NodeDetail>(`/nodes/${nodeId}`),
  createNode: (body: NodeUpsertBody) =>
    request<GraphNode>("/nodes", { method: "POST", body: JSON.stringify(body) }),
  updateNode: (nodeId: string, body: Partial<NodeUpsertBody>) =>
    request<GraphNode>(`/nodes/${nodeId}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteNode: (nodeId: string) => request<void>(`/nodes/${nodeId}`, { method: "DELETE" }),

  createEdge: (parentNodeId: string, childNodeId: string, isFallback = false) =>
    request<GraphEdge>(`/nodes/${parentNodeId}/edges`, {
      method: "POST",
      body: JSON.stringify({ child_node_id: childNodeId, is_fallback: isFallback }),
    }),
  setEdgeFallback: (edgeId: string, isFallback: boolean) =>
    request<GraphEdge>(`/edges/${edgeId}?is_fallback=${isFallback}`, { method: "PUT" }),
  deleteEdge: (edgeId: string) => request<void>(`/edges/${edgeId}`, { method: "DELETE" }),

  startSession: (nodeId: string) =>
    request<SessionStartResponse>("/session", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId }),
    }),
  routeSession: (nodeId: string, currentNodeId: string, summary: string) =>
    request<SessionRouteResponse>("/session/route", {
      method: "POST",
      body: JSON.stringify({ node_id: nodeId, current_node_id: currentNodeId, summary }),
    }),
};
