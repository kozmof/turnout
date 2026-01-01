import type {
  ExecutionContext,
  ValueId,
  FuncId,
  BinaryFnNames,
  TransformFnNames,
} from '../types';
import type { AnyValue, TagSymbol } from '../../state-control/value';

/**
 * Converts a mapped type with branded keys to an index signature type.
 * This allows us to build tables progressively with string keys.
 */
type ToIndexSignature<T> = T extends Record<string, infer V>
  ? { [key: string]: V }
  : never;

/**
 * Builder for plug functions.
 */
export type PlugBuilder = {
  readonly __type: 'plug';
  readonly name: BinaryFnNames;
  readonly args: Record<string, ValueRef | TransformRef>;
};

/**
 * Builder for tap functions.
 */
export type TapBuilder = {
  readonly __type: 'tap';
  readonly args: readonly TapArg[];
  readonly argBindings: Record<string, ValueRef>; // Maps arg names to value IDs
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
 * Reference to a value with a transform applied.
 */
export type TransformRef = {
  readonly __type: 'transform';
  readonly valueId: ValueRef;
  readonly transformFn: TransformFnNames;
};

/**
 * Tap function argument definition.
 */
export type TapArg = {
  readonly name: string;
  readonly type: 'number' | 'string' | 'boolean' | 'array';
};

/**
 * Step in a tap function.
 */
export type StepBuilder = PlugBuilder | TapBuilder;

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
  | AnyValue
  | readonly AnyValue[];

/**
 * Any function builder.
 */
export type FunctionBuilder = PlugBuilder | TapBuilder | CondBuilder;

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
 * Internal state during context building.
 * Uses index signatures instead of branded keys to allow progressive building.
 */
export type ContextBuilder = {
  valueTable: ToIndexSignature<ExecutionContext['valueTable']>;
  funcTable: ToIndexSignature<ExecutionContext['funcTable']>;
  plugFuncDefTable: ToIndexSignature<ExecutionContext['plugFuncDefTable']>;
  tapFuncDefTable: ToIndexSignature<ExecutionContext['tapFuncDefTable']>;
  condFuncDefTable: ToIndexSignature<ExecutionContext['condFuncDefTable']>;
  nextDefId: number;
};
