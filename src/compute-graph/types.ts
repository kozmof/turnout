import { BinaryFnArrayNames, BinaryFnArrayNameSpace } from '../state-control/preset-funcs/array/binaryFn';
import { TransformFnArrayNames } from '../state-control/preset-funcs/array/transformFn';
import { BinaryFnBooleanNames, BinaryFnBooleanNameSpace } from '../state-control/preset-funcs/boolean/binaryFn';
import { TransformFnBooleanNames } from '../state-control/preset-funcs/boolean/transformFn';
import { BinaryFnGenericNames, BinaryFnGenericNameSpace } from '../state-control/preset-funcs/generic/binaryFn';
import { BinaryFnNumberNames, BinaryFnNumberNameSpace } from '../state-control/preset-funcs/number/binaryFn';
import { TransformFnNumberNames } from '../state-control/preset-funcs/number/transformFn';
import { TransformFnNullNames } from '../state-control/preset-funcs/null/transformFn';
import { BinaryFnStringNames, BinaryFnStringNameSpace } from '../state-control/preset-funcs/string/binaryFn';
import { TransformFnStringNames } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';
import { Brand } from '../util/brand';

export type BinaryFnNames =
  | BinaryFnArrayNames
  | BinaryFnBooleanNames
  | BinaryFnGenericNames
  | BinaryFnNumberNames
  | BinaryFnStringNames;

export type BinaryFnNamespaces =
  | BinaryFnArrayNameSpace
  | BinaryFnBooleanNameSpace
  | BinaryFnGenericNameSpace
  | BinaryFnNumberNameSpace
  | BinaryFnStringNameSpace

export type TransformFnNames =
  | TransformFnArrayNames
  | TransformFnBooleanNames
  | TransformFnNumberNames
  | TransformFnNullNames
  | TransformFnStringNames;

export type CombineDefineId = Brand<string, 'combineDefineId'>;
export type PipeDefineId = Brand<string, 'pipeDefineId'>;
export type CondDefineId = Brand<string, 'condDefineId'>;
export type ValueId = Brand<string, 'valueId'>;
export type FuncId = Brand<string, 'funcId'>;
export type PipeArgName = Brand<string, 'pipeArgName'>;

// Fix 2: Discriminated union on FuncTable entries — kind is a first-class field.
export type FuncTableEntry =
  | { kind: 'combine'; defId: CombineDefineId; argMap: { [argName in string]: ValueId }; returnId: ValueId }
  | { kind: 'pipe';    defId: PipeDefineId;    argMap: { [argName in string]: ValueId }; returnId: ValueId }
  | { kind: 'cond';   defId: CondDefineId;    returnId: ValueId };

export type FuncTable = {
  [id in FuncId]: FuncTableEntry;
};

export type CombineFuncDefTable = {
  [defId in CombineDefineId]: {
    name: BinaryFnNames;
    // Fix 4: transformFn values are TransformFnNames directly (no { name } wrapper).
    transformFn: {
      a: TransformFnNames;
      b: TransformFnNames;
    };
    args: {
      a: true;
      b: true;
    };
  };
};

/**
 * Represents how a step's argument is bound to a value source.
 * - 'input': Binds to an argument passed to the PipeFunc
 * - 'step': Binds to the return value of a previous step (by index)
 * - 'value': Binds directly to a ValueId (constant or pre-computed value)
 */
// Fix 3: 'value' variant field renamed from valueId to id — consistent with ConditionId.
export type PipeArgBinding =
  | { source: 'input'; argName: PipeArgName }
  | { source: 'step'; stepIndex: number }
  | { source: 'value'; id: ValueId };

/**
 * Defines a single step in a PipeFunc sequence.
 * Each step references a function definition and specifies how its arguments are bound.
 */
export type PipeStepBinding = {
  defId: CombineDefineId | PipeDefineId;
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
      [argName in string]: true;
    };
    sequence: PipeStepBinding[];
  };
};

export type ConditionId =
  | { readonly source: 'value'; readonly id: ValueId }
  | { readonly source: 'func'; readonly id: FuncId };

export type CondFuncDefTable = {
  [defId in CondDefineId]: {
    conditionId: ConditionId;
    trueBranchId: FuncId;
    falseBranchId: FuncId;
  };
};

export type ValueTable = {
  [id in ValueId]: AnyValue;
};

// Fix 6: Single canonical definition of ExecutionResult.
export type ExecutionResult = {
  readonly value: AnyValue;
  readonly updatedValueTable: ValueTable;
};

/**
 * ExecutionContext contains all the data needed to execute a graph.
 *
 * All tables are read-only at the type level to enforce immutability.
 * Execution functions return new ValueTables rather than mutating the context.
 * This makes the data flow explicit and supports functional execution patterns.
 */
// Fix 5: returnIdToFuncId removed — it was a performance cache, not a domain field.
export type ExecutionContext = {
  readonly valueTable: Readonly<ValueTable>;
  readonly funcTable: Readonly<FuncTable>;
  readonly combineFuncDefTable: Readonly<CombineFuncDefTable>;
  readonly pipeFuncDefTable: Readonly<PipeFuncDefTable>;
  readonly condFuncDefTable: Readonly<CondFuncDefTable>;
};

/**
 * Pipe-local scoped execution context.
 *
 * Scope is explicit at the type level so Pipe execution code can
 * distinguish restricted visibility contexts from full root contexts.
 */
export type ScopedExecutionContext = ExecutionContext & {
  readonly scope: 'pipe';
  readonly visibleValueIds: ReadonlySet<ValueId>;
};
