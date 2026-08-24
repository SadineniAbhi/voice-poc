import type { GraphEdge, GraphNode } from "../types";

/** Simple BFS-depth column layout: nodes with no incoming edge start at depth 0, each hop
 * moves one column right. Good enough for a routing graph's natural left-to-right flow;
 * no need for a full auto-layout library at this scale.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Record<string, { x: number; y: number }> {
  const childrenOf: Record<string, string[]> = {};
  const hasIncoming = new Set<string>();
  edges.forEach((e) => {
    (childrenOf[e.parent_node_id] ??= []).push(e.child_node_id);
    hasIncoming.add(e.child_node_id);
  });

  const depth: Record<string, number> = {};
  const queue: [string, number][] = nodes
    .filter((n) => !hasIncoming.has(n.node_id))
    .map((n) => [n.node_id, 0]);
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [id, d] = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    depth[id] = d;
    (childrenOf[id] ?? []).forEach((childId) => queue.push([childId, d + 1]));
  }
  // Orphans / cycles not reached by the BFS just start their own column.
  nodes.forEach((n) => {
    if (!(n.node_id in depth)) depth[n.node_id] = 0;
  });

  const columns: Record<number, string[]> = {};
  nodes.forEach((n) => {
    const d = depth[n.node_id];
    (columns[d] ??= []).push(n.node_id);
  });

  const positions: Record<string, { x: number; y: number }> = {};
  Object.values(columns).forEach((ids) => {
    ids.forEach((id, i) => {
      positions[id] = { x: depth[id] * 300, y: i * 170 };
    });
  });
  return positions;
}
