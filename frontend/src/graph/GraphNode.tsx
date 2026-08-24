import { Handle, Position, type NodeProps } from "reactflow";

export interface GraphNodeData {
  name: string;
  description: string | null;
  capabilities: string | null;
  isLeaf: boolean;
  selected: boolean;
}

export default function GraphNodeCard({ data }: NodeProps<GraphNodeData>) {
  return (
    <div className={`graph-node${data.selected ? " graph-node--selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="graph-node-header">
        <span className="graph-node-name">{data.name}</span>
        <span className={`tag ${data.isLeaf ? "" : "accent"}`}>
          {data.isLeaf ? "Endpoint" : "Router"}
        </span>
      </div>
      {data.description && <div className="graph-node-desc">{data.description}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
