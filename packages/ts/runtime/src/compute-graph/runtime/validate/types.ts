import type {
  ExecutionContext,
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  ValueTable,
  FuncTable,
} from '../../types';
import type { BaseTypeSymbol } from '../../../state-control/value';
import { baseTypeSymbols } from '../../../state-control/value';

// ============================================================================
// Constants
// ============================================================================

export const VALID_BASE_TYPE_SYMBOLS = new Set(baseTypeSymbols);

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

const _validatedBrand: unique symbol = Symbol('validatedContext');

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

// ============================================================================
// ValidationState — mutable accumulator shared across all validators
// ============================================================================

export type ValidationState = {
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
  readonly referencedValues: Set<ValueId>;
  readonly referencedDefs: Set<CombineDefineId | PipeDefineId | CondDefineId>;
  readonly returnIds: Set<ValueId>;
  readonly returnIdToFuncId: Map<string, string>;
  // Intentionally mutable during the validation pass — entries are added lazily
  // as types are inferred. The exported TypeEnvironment alias uses ReadonlyMap
  // for the frozen snapshot exposed to consumers after validation completes.
  readonly typeEnv: Map<ValueId | FuncId, BaseTypeSymbol>;
};

export function createValidationState(): ValidationState {
  return {
    errors: [],
    warnings: [],
    referencedValues: new Set(),
    referencedDefs: new Set(),
    returnIds: new Set(),
    returnIdToFuncId: new Map(),
    typeEnv: new Map(),
  };
}
