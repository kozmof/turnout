import { BinaryFnArrayNames, BinaryFnArrayNameSpace } from '../state-control/preset-funcs/array/binaryFn';
import { TransformFnArrayNames } from '../state-control/preset-funcs/array/transformFn';
import { BinaryFnGenericNames, BinaryFnGenericNameSpace } from '../state-control/preset-funcs/generic/binaryFn';
import { BinaryFnNumberNames, BinaryFnNumberNameSpace } from '../state-control/preset-funcs/number/binaryFn';
import { TransformFnNumberNames } from '../state-control/preset-funcs/number/transformFn';
import { BinaryFnStringNames, BinaryFnStringNameSpace } from '../state-control/preset-funcs/string/binaryFn';
import { TransformFnStringNames } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';
import { Brand } from '../util/brand';

export type BinaryFnNames =
  | BinaryFnArrayNames
  | BinaryFnGenericNames
  | BinaryFnNumberNames
  | BinaryFnStringNames;

export type BinaryFnNamespaces = 
  | BinaryFnArrayNameSpace
  | BinaryFnGenericNameSpace
  | BinaryFnNumberNameSpace
  | BinaryFnStringNameSpace

export type TransformFnNames =
  | TransformFnArrayNames
  | TransformFnNumberNames
  | TransformFnStringNames;

type FuncInterface = { name: string; type: 'value'; value: AnyValue };

export type PlugFuncType = 'plug';
export type TapFuncType = 'tap';
export type CondFuncType = 'cond';

export type PlugFunc = {
  name: BinaryFnNames;
  type: PlugFuncType;
  transformFn: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | PlugFunc;
    b: FuncInterface | PlugFunc;
  };
};

export type TapFunc = {
  name: string;
  type: TapFuncType;
  steps: (TapFunc | PlugFunc)[];
  args: FuncInterface[];
};

export type CondFunc = {
  name: string;
  type: CondFuncType;
  condition: FuncInterface | PlugFunc;
  trueBranch: TapFunc | PlugFunc;
  falseBranch: TapFunc | PlugFunc;
};

export type PlugDefineId = Brand<string, 'plugDefineId'>;
export type TapDefineId = Brand<string, 'tapDefineId'>;
export type CondDefineId = Brand<string, 'condDefineId'>;
export type ValueId = Brand<string, 'valueId'>;
export type FuncId = Brand<string, 'funcId'>;
export type InterfaceArgId = Brand<string, 'interfaceArgId'>;

export type FuncTable = {
  [id in FuncId]: {
    defId: PlugDefineId | TapDefineId | CondDefineId;
    argMap: {
      [argName in string]: ValueId;
    };
    returnId: ValueId;
  };
};

export type PlugFuncDefTable = {
  [defId in PlugDefineId]: {
    name: BinaryFnNames;
    transformFn: {
      a: { name: TransformFnNames };
      b: { name: TransformFnNames };
    };
    args: {
      a: InterfaceArgId;
      b: InterfaceArgId;
    };
  };
};

/**
 * Represents how a step's argument is bound to a value source.
 * - 'input': Binds to an argument passed to the TapFunc
 * - 'step': Binds to the return value of a previous step (by index)
 * - 'value': Binds directly to a ValueId (constant or pre-computed value)
 */
export type TapArgBinding =
  | { source: 'input'; argName: string }
  | { source: 'step'; stepIndex: number }
  | { source: 'value'; valueId: ValueId };

/**
 * Defines a single step in a TapFunc sequence.
 * Each step references a function definition and specifies how its arguments are bound.
 */
export type TapStepBinding = {
  defId: PlugDefineId | TapDefineId | CondDefineId;
  argBindings: {
    [argName: string]: TapArgBinding;
  };
};

/**
 * TapFunc definition table.
 * TapFunc executes a sequence of function definitions in order,
 * threading values through the sequence where each step can reference:
 * - Arguments passed to the TapFunc
 * - Results from previous steps
 * - Direct value references
 */
export type TapFuncDefTable = {
  [defId in TapDefineId]: {
    args: {
      [argName in string]: InterfaceArgId;
    };
    sequence: TapStepBinding[];
  };
};

export type CondFuncDefTable = {
  [defId in CondDefineId]: {
    conditionId: FuncId | ValueId;
    trueBranchId: FuncId;
    falseBranchId: FuncId;
  };
};

export type ValueTable = {
  [id in ValueId]: AnyValue;
};

/**
 * ExecutionContext contains all the data needed to execute a graph.
 *
 * Note: The valueTable is mutated during execution as functions produce results.
 * The definition tables (funcTable, plugFuncDefTable, etc.) should be treated
 * as read-only during execution.
 */
export type ExecutionContext = {
  /** Mutable table of computed values. Updated during execution. */
  valueTable: ValueTable;
  /** Function instances table. Should be read-only during execution. */
  funcTable: FuncTable;
  /** Plug function definitions. Should be read-only during execution. */
  plugFuncDefTable: PlugFuncDefTable;
  /** Tap function definitions. Should be read-only during execution. */
  tapFuncDefTable: TapFuncDefTable;
  /** Conditional function definitions. Should be read-only during execution. */
  condFuncDefTable: CondFuncDefTable;
  /** Pre-computed mapping for performance optimization. Optional. */
  returnIdToFuncId?: ReadonlyMap<ValueId, FuncId>;
};
