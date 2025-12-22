import { BinaryFnArrayNames } from '../state-control/preset-funcs/array/binaryFn';
import { TransformFnArrayNames } from '../state-control/preset-funcs/array/transformFn';
import { BinaryFnGenericNames } from '../state-control/preset-funcs/generic/binaryFn';
import { BinaryFnNumberNames } from '../state-control/preset-funcs/number/binaryFn';
import { TransformFnNumberNames } from '../state-control/preset-funcs/number/transformFn';
import { BinaryFnStringNames } from '../state-control/preset-funcs/string/binaryFn';
import { TransformFnStringNames } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';
import { Brand } from '../util/brand';

export type BinaryFnNames =
  | BinaryFnArrayNames
  | BinaryFnGenericNames
  | BinaryFnNumberNames
  | BinaryFnStringNames;

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
      [argName in string]: FuncId | ValueId;
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
      a: PlugDefineId | InterfaceArgId;
      b: PlugDefineId | InterfaceArgId;
    };
  };
};

export type TapFuncDefTable = {
  [defId in TapDefineId]: {
    args: {
      [argName in string]: InterfaceArgId;
    };
    sequence: FuncId[];
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
 *
 * If you need to preserve the original context, create a copy before execution
 * using the cloneContextForExecution helper.
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
