/**
 * Builder API for creating ExecutionContext instances.
 *
 * This provides a high-level, declarative API that reduces boilerplate
 * while maintaining full type safety and compatibility with the low-level API.
 *
 * @example
 * ```typescript
 * import { ctx, plug } from '@turnout/punch-card/builder';
 *
 * const context = ctx({
 *   v1: 5,
 *   v2: 3,
 *   f1: plug('binaryFnNumber::add', { a: 'v1', b: 'v2' }),
 * });
 *
 * const result = executeGraph(context.ids.f1, context.exec);
 * ```
 */

export { ctx } from './context';
export { plug, tap, cond } from './functions';
export { val, ref } from './values';
export type { ContextBuilder, ContextSpec, BuildResult } from './types';
