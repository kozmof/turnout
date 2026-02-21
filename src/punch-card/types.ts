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

export type CombineFuncType = 'combine';
export type PipeFuncType = 'pipe';
export type CondFuncType = 'cond';

export type CombineFunc = {
  name: BinaryFnNames;
  type: CombineFuncType;
  transformFn: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | CombineFunc;
    b: FuncInterface | CombineFunc;
  };
};

export type PipeFunc = {
  name: string;
  type: PipeFuncType;
  steps: (PipeFunc | CombineFunc)[];
  args: FuncInterface[];
};

export type CondFunc = {
  name: string;
  type: CondFuncType;
  condition: FuncInterface | CombineFunc;
  trueBranch: PipeFunc | CombineFunc;
  falseBranch: PipeFunc | CombineFunc;
};

export type CombineDefineId = Brand<string, 'combineDefineId'>;
export type PipeDefineId = Brand<string, 'pipeDefineId'>;
export type CondDefineId = Brand<string, 'condDefineId'>;
export type ValueId = Brand<string, 'valueId'>;
export type FuncId = Brand<string, 'funcId'>;
export type InterfaceArgId = Brand<string, 'interfaceArgId'>;

export type FuncTable = {
  [id in FuncId]: {
    defId: CombineDefineId | PipeDefineId | CondDefineId;
    argMap: {
      [argName in string]: ValueId;
    };
    returnId: ValueId;
  };
};

export type CombineFuncDefTable = {
  [defId in CombineDefineId]: {
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
 * - 'input': Binds to an argument passed to the PipeFunc
 * - 'step': Binds to the return value of a previous step (by index)
 * - 'value': Binds directly to a ValueId (constant or pre-computed value)
 */
export type PipeArgBinding =
  | { source: 'input'; argName: string }
  | { source: 'step'; stepIndex: number }
  | { source: 'value'; valueId: ValueId };

/**
 * Defines a single step in a PipeFunc sequence.
 * Each step references a function definition and specifies how its arguments are bound.
 */
export type PipeStepBinding = {
  defId: CombineDefineId | PipeDefineId | CondDefineId;
  argBindings: {
    [argName: string]: PipeArgBinding;
  };
};

/**
 * PipeFunc definition table.
 * PipeFunc executes a sequence of function definitions in order,
 * threading values through the sequence where each step can reference:
 * - Arguments passed to the PipeFunc
 * - Results from previous steps
 * - Direct value references
 */
export type PipeFuncDefTable = {
  [defId in PipeDefineId]: {
    args: {
      [argName in string]: InterfaceArgId;
    };
    sequence: PipeStepBinding[];
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
  /** Combine function definitions. Read-only during execution. */
  readonly combineFuncDefTable: Readonly<CombineFuncDefTable>;
  /** Pipe function definitions. Read-only during execution. */
  readonly pipeFuncDefTable: Readonly<PipeFuncDefTable>;
  /** Conditional function definitions. Read-only during execution. */
  readonly condFuncDefTable: Readonly<CondFuncDefTable>;
  /** Pre-computed mapping for performance optimization. Optional. */
  readonly returnIdToFuncId?: ReadonlyMap<ValueId, FuncId>;
};
