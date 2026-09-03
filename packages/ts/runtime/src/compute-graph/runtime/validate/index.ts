import { validateLegacyContextWithZig } from "../../../zig-runtime/legacy-validation.js";
import {
  createValidatedContext,
  isValidationSuccess,
  type TypeEnvironment,
  type UnvalidatedContext,
  type ValidatedContext,
  type ValidationError,
  type ValidationResult,
  type ValidationWarning,
} from "./types.js";

export type {
  UnvalidatedContext,
  ValidatedContext,
  ValidationError,
  ValidationWarning,
  ValidationResult,
  TypeEnvironment,
};
export { isValidationSuccess };

export function validateContext(context: UnvalidatedContext): ValidationResult {
  const result = validateLegacyContextWithZig(context);
  if (!result.valid) {
    return { valid: false, errors: result.errors, warnings: result.warnings };
  }
  return {
    valid: true,
    context: createValidatedContext(context as Parameters<typeof createValidatedContext>[0]),
    warnings: result.warnings,
    errors: [],
  };
}

export function assertValidContext(context: UnvalidatedContext): ValidatedContext {
  const result = validateContext(context);
  if (!result.valid) {
    const errorMessages = result.errors.map((error) => `  - ${error.message}`).join("\n");
    throw new Error(`ExecutionContext validation failed:\n${errorMessages}`);
  }
  return result.context;
}

export function isValidContext(context: UnvalidatedContext): context is ValidatedContext {
  return validateContext(context).valid;
}
