import type { FuncId, FuncTable, ValueId } from "runtime";
import type { ProgModel } from "../types/turnout-model_pb.js";
import { toFuncId, toValueId } from "./dynamic-boundary.js";
import { SceneRuntimeError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ids + funcTable → nameToValueId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a binding-name → ValueId map from the IDs and funcTable produced by
 * `ctx()`.
 *
 * For value bindings the id IS the ValueId. For function bindings the result
 * lives in the function's return value slot (`funcTable[id].returnId`).
 *
 * Exported for unit testing — can be exercised with synthetic ids/funcTable
 * without constructing a full ExecutionContext.
 */
export function buildNameToValueId(
  bindings: ProgModel["bindings"],
  ids: Record<string, FuncId | ValueId>,
  funcTable: FuncTable,
  contextId = "(unknown)",
): Map<string, ValueId> {
  const nameToValueId = new Map<string, ValueId>();
  for (const binding of bindings) {
    const id = ids[binding.name];
    if (id === undefined) {
      throw new SceneRuntimeError(
        "UnknownArgModel",
        contextId,
        `binding "${binding.name}" not found in context ID map — this is a compiler bug`,
      );
    }
    if (binding.expr) {
      // Function binding: the result lives in the function's return value slot.
      nameToValueId.set(binding.name, funcTable[toFuncId(id as string)].returnId);
    } else {
      // Value binding: the id is the ValueId directly.
      nameToValueId.set(binding.name, toValueId(id as string));
    }
  }
  return nameToValueId;
}
