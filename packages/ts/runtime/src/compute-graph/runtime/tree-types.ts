import type { FuncId, ValueId } from "../types.js";

export type NodeId = FuncId | ValueId;

/**
 * Execution tree node representing the computation graph.
 * Uses discriminated union for type-safe access to node-specific fields.
 */
