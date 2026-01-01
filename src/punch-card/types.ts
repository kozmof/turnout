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
 * All tables are read-only at the type level to enforce immutability.
 * Execution functions return new ValueTables rather than mutating the context.
 * This makes the data flow explicit and supports functional execution patterns.
 */
export type ExecutionContext = {
  /** Table of computed values. Read-only; execution returns updated copies. */
  readonly valueTable: Readonly<ValueTable>;
  /** Function instances table. Read-only during execution. */
  readonly funcTable: Readonly<FuncTable>;
  /** Plug function definitions. Read-only during execution. */
  readonly plugFuncDefTable: Readonly<PlugFuncDefTable>;
  /** Tap function definitions. Read-only during execution. */
  readonly tapFuncDefTable: Readonly<TapFuncDefTable>;
  /** Conditional function definitions. Read-only during execution. */
  readonly condFuncDefTable: Readonly<CondFuncDefTable>;
  /** Pre-computed mapping for performance optimization. Optional. */
  readonly returnIdToFuncId?: ReadonlyMap<ValueId, FuncId>;
};
