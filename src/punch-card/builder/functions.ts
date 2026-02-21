import type {
  PlugBuilder,
  TapBuilder,
  CondBuilder,
  ValueRef,
  FuncRef,
  FuncOutputRef,
  StepOutputRef,
  TransformRef,
  TapArg,
  StepBuilder,
} from './types';
import type { BinaryFnNames } from '../types';

/**
 * Creates a CombineFunc builder.
 *
 * @param name - Namespaced binary function name (e.g., 'binaryFnNumber::add')
 * @param args - Arguments mapping to value references
 *
 * @example
 * ```typescript
 * plug('binaryFnNumber::add', { a: 'v1', b: 'v2' })
 * plug('binaryFnString::concat', {
 *   a: ref('v1').transform('transformFnNumber::toStr'),
 *   b: 'v2'
 * })
 * ```
 */
export function plug(
  name: BinaryFnNames,
  args: Record<string, ValueRef | FuncOutputRef | StepOutputRef | TransformRef>
): PlugBuilder {
  return {
    __type: 'combine',
    name,
    args,
  };
}

/**
 * Creates a PipeFunc builder (sequential execution).
 *
 * @param argBindings - Maps argument names to value IDs
 * @param steps - Sequence of steps to execute
 *
 * @example
 * ```typescript
 * tap(
 *   { x: 'v1', y: 'v2' },
 *   [
 *     plug('binaryFnNumber::add', { a: 'x', b: 'y' }),
 *     plug('binaryFnNumber::multiply', { a: ref.output('step0'), b: 'x' })
 *   ]
 * )
 * ```
 */
export function tap(
  argBindings: Record<string, ValueRef>,
  steps: readonly StepBuilder[]
): TapBuilder {
  // Infer args from argBindings keys
  const inferredArgs: TapArg[] = Object.keys(argBindings).map(name => ({
    name,
    type: 'number' as const, // Default (unused at runtime anyway)
  }));

  return {
    __type: 'pipe',
    args: inferredArgs,
    argBindings,
    steps,
  };
}

/**
 * Creates a CondFunc builder (conditional execution).
 *
 * @param condition - Reference to boolean value
 * @param options - Then/else branch function references
 *
 * @example
 * ```typescript
 * cond('v1', { then: 'f1', else: 'f2' })
 * ```
 */
export function cond(
  condition: ValueRef,
  options: { then: FuncRef; else: FuncRef }
): CondBuilder {
  return {
    __type: 'cond',
    condition,
    then: options.then,
    else: options.else,
  };
}
