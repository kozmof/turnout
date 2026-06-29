/**
 * Complexity budgets for compute-graph traversal.
 *
 * Validation, tree construction, and execution all walk the graph. Without an
 * upper bound an adversarial (or accidentally enormous) model can exhaust
 * memory or — for deep chains — the native call stack, surfacing as an opaque
 * `RangeError: Maximum call stack size exceeded`. The validator rejects models
 * above `MAX_GRAPH_NODES` before any traversal runs; build/execute traverse
 * iteratively so a model within the node budget can never overflow the stack.
 *
 * The limits are deliberately far above any realistic hand- or tool-authored
 * model while staying well under the size at which traversal becomes a denial
 * of service. They mirror the convention used by the scene-runner's
 * `DEFAULT_MAX_STEPS` / `DEFAULT_MAX_ROUTE_TRANSITIONS` guards.
 */

/**
 * Maximum total entries across all graph tables (valueTable, funcTable, and the
 * three definition tables). Enforced once at the validation gate; because every
 * downstream traversal only runs on a validated context, this also bounds the
 * depth those traversals can reach.
 */
export const MAX_GRAPH_NODES = 50_000;
