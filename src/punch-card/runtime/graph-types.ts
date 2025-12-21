import { FuncId, ValueId } from '../types';

export type NodeId = FuncId | ValueId;

export type DependencyGraph = {
  nodes: Set<NodeId>;
  edges: Map<NodeId, Set<NodeId>>;
  inDegree: Map<NodeId, number>;
};

export type ExecutionOrder = NodeId[];

export type ExecutionState = 'pending' | 'computing' | 'completed' | 'error';

export type NodeState = {
  state: ExecutionState;
  error?: Error;
};

export type ExecutionTracker = Map<NodeId, NodeState>;
