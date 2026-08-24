export interface GraphNode {
  node_id: string;
  name: string;
  description: string | null;
  capabilities: string | null;
  voice: string | null;
  greeting: string | null;
}

export interface GraphEdge {
  edge_id: string;
  parent_node_id: string;
  child_node_id: string;
  is_fallback: boolean;
  child: GraphNode;
}

export interface NodeDetail extends GraphNode {
  outgoing_edges: GraphEdge[];
  is_leaf: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SessionStartResponse {
  client_secret: string;
  expires_at: number | null;
  model: string;
  node: GraphNode;
  children: GraphNode[];
  opening_instructions: string;
}

// A route hop mints a brand new ephemeral session, same shape as starting one fresh —
// see voice_api.py.
export type SessionRouteResponse = SessionStartResponse;

export interface AppConfig {
  stun_url: string;
  voices: string[];
}
