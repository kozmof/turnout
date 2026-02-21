import { FuncId, ValueId, CombineDefineId, PipeDefineId, CondDefineId } from '../types';
import { AnyValue } from '../../state-control/value';

export type NodeId = FuncId | ValueId;

/**
 * Execution tree node representing the computation graph.
 * Uses discriminated union for type-safe access to node-specific fields.
 */
export type ExecutionTree =
  | ValueNode
  | FunctionNode
  | ConditionalNode;

/**
 * Leaf node containing a pre-computed value.
 */
export type ValueNode = {
  readonly nodeType: 'value';
  readonly nodeId: ValueId;
  readonly value: AnyValue;
};

/**
 * Internal node representing a function call (CombineFunc or PipeFunc).
 */
export type FunctionNode = {
  readonly nodeType: 'function';
  readonly nodeId: FuncId;
  readonly funcDef: CombineDefineId | PipeDefineId;
  readonly returnId: ValueId;
  readonly children?: readonly ExecutionTree[];
};

/**
 * Conditional node representing a CondFunc with lazy branch evaluation.
 */
export type ConditionalNode = {
  readonly nodeType: 'conditional';
  readonly nodeId: FuncId;
  readonly funcDef: CondDefineId;
  readonly returnId: ValueId;
  readonly conditionTree: ExecutionTree;
  readonly trueBranchTree: ExecutionTree;
  readonly falseBranchTree: ExecutionTree;
};
