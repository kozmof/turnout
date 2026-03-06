/**
 * Builder API for creating ExecutionContext instances.
 *
 * This provides a high-level, declarative API that reduces boilerplate
 * while maintaining full type safety and compatibility with the low-level API.
 *
 * @example
 * ```typescript
 * import { ctx, combine, pipe, cond, ref } from '@turnout/compute-graph/builder';
 *
 * const context = ctx({
 *   v1: 5,
 *   v2: 3,
 *
 *   // Simple combine function
 *   sum: combine('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
 *
 *   // Pipe function with simplified API - no need for type annotations!
 *   compute: pipe(
 *     { x: 'v1', y: 'v2' },
 *     [
 *       combine('binaryFnNumber::multiply', { a: 'x', b: 'y' }),
 *       combine('binaryFnNumber::add', {
 *         a: ref.output('compute__step0'),
 *         b: 'x'
 *       })
 *     ]
 *   ),
 *
 *   // Conditional function
 *   result: cond('condition', { then: 'sum', else: 'compute' }),
 * });
 *
 * const result = executeGraph(context.ids.result, context.exec);
 * ```
 */

export { ctx } from './context';
export { combine, pipe, cond } from './functions';
export { val, ref } from './values';
export type { ContextBuilder, ContextSpec, BuildResult } from './types';
export type {
  BuilderValidationError,
  UndefinedConditionError,
  UndefinedBranchError,
  UndefinedValueReferenceError,
  UndefinedPipeArgumentError,
  UndefinedPipeStepReferenceError,
} from './errors';
export { isBuilderValidationError } from './errors';
