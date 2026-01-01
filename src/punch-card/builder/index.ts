/**
 * Builder API for creating ExecutionContext instances.
 *
 * This provides a high-level, declarative API that reduces boilerplate
 * while maintaining full type safety and compatibility with the low-level API.
 *
 * @example
 * ```typescript
 * import { ctx, plug, tap, cond, ref } from '@turnout/punch-card/builder';
 *
 * const context = ctx({
 *   v1: 5,
 *   v2: 3,
 *
 *   // Simple plug function
 *   sum: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
 *
 *   // Tap function with simplified API - no need for type annotations!
 *   compute: tap(
 *     { x: 'v1', y: 'v2' },
 *     [
 *       plug('binaryFnNumber::multiply', { a: 'x', b: 'y' }),
 *       plug('binaryFnNumber::add', {
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
export { plug, tap, cond } from './functions';
export { val, ref } from './values';
export type { ContextBuilder, ContextSpec, BuildResult } from './types';
export type {
  BuilderValidationError,
  UndefinedConditionError,
  UndefinedBranchError,
  UndefinedValueReferenceError,
  UndefinedTapArgumentError,
  UndefinedTapStepReferenceError,
} from './errors';
export { isBuilderValidationError } from './errors';
