import type { ExecutionContext, ValueId, FuncId, ValueTable, FuncTable } from "../../types.js";
import type { BaseTypeSymbol } from "../../../state-control/value.js";

// ============================================================================
// UnvalidatedContext
// ============================================================================

export type UnvalidatedContext = {
  readonly valueTable?: ValueTable;
  readonly funcTable?: Partial<FuncTable>;
  readonly combineFuncDefTable?: Partial<Record<string, unknown>>;
  readonly pipeFuncDefTable?: Partial<Record<string, unknown>>;
  readonly condFuncDefTable?: Partial<Record<string, unknown>>;
};

// ============================================================================
// ValidatedContext — branded, impossible to construct outside this module
// ============================================================================

const _validatedBrand: unique symbol = Symbol("validatedContext");

export type ValidatedContext = ExecutionContext & {
  readonly [_validatedBrand]: true;
  readonly validated: true;
};

export function createValidatedContext(context: ExecutionContext): ValidatedContext {
  return {
    ...context,
    [_validatedBrand]: true,
    validated: true,
  };
}

// ============================================================================
// Discriminated result types
// ============================================================================

export type ValidationError = {
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ValidationWarning = {
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ValidationResult =
  | {
      readonly valid: true;
      readonly context: ValidatedContext;
      readonly warnings: readonly ValidationWarning[];
      readonly errors: readonly never[];
    }
  | {
      readonly valid: false;
      readonly errors: readonly ValidationError[];
      readonly warnings: readonly ValidationWarning[];
    };

export function isValidationSuccess(
  result: ValidationResult,
): result is Extract<ValidationResult, { valid: true }> {
  return result.valid;
}

// ============================================================================
// TypeEnvironment
// ============================================================================

export type TypeEnvironment = ReadonlyMap<ValueId | FuncId, BaseTypeSymbol>;
