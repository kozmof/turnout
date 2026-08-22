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
 *   sum: combine('combineFnNumber::add', { a: 'v1', b: 'v2' }),
 *
 *   // Pipe function with simplified API - no need for type annotations!
 *   compute: pipe(
 *     { x: 'v1', y: 'v2' },
 *     [
 *       combine('combineFnNumber::multiply', { a: 'x', b: 'y' }),
 *       combine('combineFnNumber::add', {
 *         // ref.step(pipeKey, stepIndex) references an earlier step's output.
 *         // (ref.output() takes a *function* key, not a synthesised step name —
 *         // step ids are internal and not addressable from a spec.)
 *         a: ref.step('compute', 0),
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

export { ctx } from "./context.js";
export { combine, pipe, cond } from "./functions.js";
export { val, ref } from "./values.js";
export type { ContextBuilder, ContextSpec, BuildResult } from "./types.js";
export type {
  BuilderValidationError,
  UndefinedConditionError,
  UndefinedBranchError,
  UndefinedValueReferenceError,
  UndefinedPipeArgumentError,
  UndefinedPipeStepReferenceError,
} from "./errors.js";
export {
  isBuilderValidationError,
  BuilderInvariantError,
  isBuilderInvariantError,
} from "./errors.js";
export type { BuilderInvariantCode } from "./errors.js";
