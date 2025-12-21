import { FuncId, ValueId, PlugDefineId, TapDefineId, CondDefineId } from '../types';
import { AnyValue } from '../../state-control/value';

export type NodeId = FuncId | ValueId;

export type ExecutionTree = {
  nodeId: NodeId;
  nodeType: 'function' | 'value' | 'conditional';

  // For function nodes
  funcDef?: PlugDefineId | TapDefineId | CondDefineId;
  children?: ExecutionTree[];
  returnId?: ValueId;

  // For conditional nodes
  conditionTree?: ExecutionTree;
  trueBranchTree?: ExecutionTree;
  falseBranchTree?: ExecutionTree;

  // For value nodes (leaves)
  value?: AnyValue;
};
