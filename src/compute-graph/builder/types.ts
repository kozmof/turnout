import type {
  ExecutionContext,
  ValueId,
  FuncId,
  BinaryFnNames,
  TransformFnNames,
} from '../types';
import type { AnyValue, BaseTypeSymbol } from '../../state-control/value';

/**
 * Converts a mapped type with branded keys to an index signature type.
 * This allows us to build tables progressively with string keys.
 */
type ToIndexSignature<T> = T extends Record<string, infer V>
  ? { [key: string]: V }
  : never;

/**
 * Builder for combine functions.
 */
export type CombineBuilder = {
  readonly __type: 'combine';
  readonly name: BinaryFnNames;
  readonly args: {
    readonly a: ValueRef | FuncOutputRef | StepOutputRef | TransformRef;
    readonly b: ValueRef | FuncOutputRef | StepOutputRef | TransformRef;
  };
};

/**
 * Builder for pipe functions.
 */
export type PipeBuilder = {
  readonly __type: 'pipe';
  readonly argBindings: Record<string, ValueRef>; // Single source of truth for pipe arg names and bindings
  readonly steps: readonly StepBuilder[];
};

/**
 * Builder for conditional functions.
 */
export type CondBuilder = {
  readonly __type: 'cond';
  readonly condition: ValueRef;
  readonly then: FuncRef;
  readonly else: FuncRef;
};

/**
 * Reference to a value (by ID string).
 */
export type ValueRef = string;

/**
 * Reference to a function (by ID string).
 */
export type FuncRef = string;

/**
 * Reference to a function's output value.
 */
export type FuncOutputRef = {
  readonly __type: 'funcOutput';
  readonly funcId: FuncRef;
};

/**
 * Reference to a pipe function step's output value.
 */
export type StepOutputRef = {
  readonly __type: 'stepOutput';
  readonly pipeFuncId: FuncRef;
  readonly stepIndex: number;
};

/**
 * Reference to a value with a transform applied.
 */
export type TransformRef = {
  readonly __type: 'transform';
  readonly valueId: ValueRef | FuncOutputRef | StepOutputRef;
  readonly transformFn: TransformFnNames;
};

/**
 * Step in a pipe function.
 */
export type StepBuilder = CombineBuilder | PipeBuilder;

/**
 * Context specification - user-friendly definition.
 */
export type ContextSpec = Record<string, ValueLiteral | FunctionBuilder>;

/**
 * Value literal - JavaScript primitives that map to Value types.
 */
export type ValueLiteral =
  | number
  | string
  | boolean
  | null
  | AnyValue
  | readonly AnyValue[];

/**
 * Any function builder.
 */
export type FunctionBuilder = CombineBuilder | PipeBuilder | CondBuilder;

/**
 * Result of building a context.
 */
export type BuildResult<T extends ContextSpec> = {
  /**
   * The execution context ready for use.
   */
  readonly exec: ExecutionContext;

  /**
   * Typed IDs for values and functions.
   */
  readonly ids: {
    readonly [K in keyof T]: T[K] extends FunctionBuilder
      ? FuncId
      : ValueId;
  };
};

/**
 * Maps step output ValueIds to their metadata.
 */
export type StepMetadataTable = {
  [stepOutputId: string]: {
    readonly parentFuncId: FuncId;
    readonly stepIndex: number;
    returnType?: BaseTypeSymbol;
  };
};

/**
 * Maps function return ValueIds to their source FuncId.
 */
export type ReturnValueMetadataTable = {
  [returnValueId: string]: {
    readonly sourceFuncId: FuncId;
  };
};

/**
 * Internal state during context building.
 * Uses index signatures instead of branded keys to allow progressive building.
 */
export type ContextBuilder = {
  valueTable: ToIndexSignature<ExecutionContext['valueTable']>;
  funcTable: ToIndexSignature<ExecutionContext['funcTable']>;
  combineFuncDefTable: ToIndexSignature<ExecutionContext['combineFuncDefTable']>;
  pipeFuncDefTable: ToIndexSignature<ExecutionContext['pipeFuncDefTable']>;
  condFuncDefTable: ToIndexSignature<ExecutionContext['condFuncDefTable']>;

  // Metadata tables for hash-based IDs
  stepMetadata: StepMetadataTable;
  returnValueMetadata: ReturnValueMetadataTable;
};
