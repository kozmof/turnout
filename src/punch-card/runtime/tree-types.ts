import { FuncId, ValueId, PlugDefineId, TapDefineId } from '../types';
import { AnyValue } from '../../state-control/value';

export type NodeId = FuncId | ValueId;

export type ExecutionTree = {
  nodeId: NodeId;
  nodeType: 'function' | 'value';

  // For function nodes
  funcDef?: PlugDefineId | TapDefineId;
  children?: ExecutionTree[];
  returnId?: ValueId;

  // For value nodes (leaves)
  value?: AnyValue;
};
