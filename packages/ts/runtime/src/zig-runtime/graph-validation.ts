import type {
  UnvalidatedContext,
  ValidationError,
  ValidationWarning,
} from "../compute-graph/runtime/validateContext.js";
import { defaultZigRuntimeClient } from "./default-client.js";

export type ZigGraphValidationResult = {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
};

export function validateGraphContextWithZig(context: UnvalidatedContext): ZigGraphValidationResult {
  const response = defaultZigRuntimeClient.compute<ZigGraphValidationResult & { error?: string }>({
    // "legacy" names the graph-context request shape, not a deprecated path:
    // this is the live validator behind the builder API. The spelling is fixed
    // by ABI version 1 and cannot change without a version bump.
    operation: "validateLegacy",
    context,
  });
  if (response.status !== "ok") {
    throw new Error(`Zig validation failed: ${response.payload.error ?? response.status}`);
  }
  return response.payload;
}
