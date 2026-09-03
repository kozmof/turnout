import type { UnvalidatedContext, ValidationError, ValidationWarning } from "../compute-graph/runtime/validateContext.js";
import { defaultZigRuntimeClient } from "./default-client.js";

export type ZigLegacyValidationResult = {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationWarning[];
};

export function validateLegacyContextWithZig(
  context: UnvalidatedContext,
): ZigLegacyValidationResult {
  const response = defaultZigRuntimeClient.compute<ZigLegacyValidationResult & { error?: string }>({
    operation: "validateLegacy",
    context,
  });
  if (response.status !== "ok") {
    throw new Error(`Zig validation failed: ${response.payload.error ?? response.status}`);
  }
  return response.payload;
}
