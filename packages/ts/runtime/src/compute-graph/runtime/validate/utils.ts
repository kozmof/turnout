import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  CombineFnNames,
} from "../../types.js";
import type { BaseTypeSymbol } from "../../../state-control/value.js";
import { getCombineFnReturnType } from "../typeInference.js";
import { inferGraphType } from "../../../zig-runtime/preset-metadata.js";
import type { UnvalidatedContext, TypeEnvironment } from "./types.js";
import { VALID_BASE_TYPE_SYMBOLS } from "./types.js";

// ============================================================================
// Generic runtime checks
// ============================================================================

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBaseTypeSymbol(value: unknown): value is BaseTypeSymbol {
  if (typeof value !== "string") return false;
  // Set membership is the runtime proof that the string is a BaseTypeSymbol.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return VALID_BASE_TYPE_SYMBOLS.has(value as BaseTypeSymbol);
}

export function isCombineDefWithCombineFnName(value: unknown): value is { name: CombineFnNames } {
  if (!(value && typeof value === "object" && "name" in value && typeof value.name === "string")) {
    return false;
  }
  // getCombineFnReturnType is the runtime proof that the string is a CombineFnNames member.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return getCombineFnReturnType(value.name as CombineFnNames) !== null;
}

export function isPipeDefWithSequence(value: unknown): value is { sequence: unknown[] } {
  return !!(
    value &&
    typeof value === "object" &&
    "sequence" in value &&
    Array.isArray(value.sequence)
  );
}

export function hasSymbolProperty(value: unknown): value is { symbol: BaseTypeSymbol } {
  return !!(
    value &&
    typeof value === "object" &&
    "symbol" in value &&
    isBaseTypeSymbol(value.symbol)
  );
}

export function hasNameAndTransformFn(
  entry: unknown,
): entry is { name: string; transformFn: unknown } {
  return !!(
    entry &&
    typeof entry === "object" &&
    "name" in entry &&
    typeof entry.name === "string" &&
    "transformFn" in entry
  );
}

// This helper intentionally brands a runtime-checked string for validation code.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function isStringAs<T>(value: unknown): value is T {
  return typeof value === "string";
}

// Own-property check, not `in`: context tables are plain object literals that
// inherit Object.prototype, so `"toString" in table` is true for every table.
// Using `in` here would let a definition id that names a prototype method pass
// validation and then blow up in the executor. See idValidation.ts for the same
// rule applied to the branded-id guards.
export function hasKey(table: unknown, key: string): boolean {
  return isRecord(table) && Object.hasOwn(table, key);
}

// ============================================================================
// Context existence guards
// ============================================================================

export function valueIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
  returnIds?: Set<ValueId>,
): value is ValueId {
  if (typeof value !== "string") return false;
  const inValueTable = hasKey(context.valueTable, value);
  // returnIds contains branded ValueIds; membership proves the runtime string belongs to that set.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const inReturnIds = returnIds && returnIds.has(value as ValueId);
  return !!(inValueTable || inReturnIds);
}

export function funcIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
): value is FuncId {
  if (typeof value !== "string") return false;
  return hasKey(context.funcTable, value);
}

export function defineIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
): value is CombineDefineId | PipeDefineId | CondDefineId {
  if (typeof value !== "string") return false;
  return (
    hasKey(context.combineFuncDefTable, value) ||
    hasKey(context.pipeFuncDefTable, value) ||
    hasKey(context.condFuncDefTable, value)
  );
}

export function pipeStepDefIdExistsInContext(
  value: unknown,
  context: UnvalidatedContext,
): { exists: boolean; isCondDef: boolean } {
  if (typeof value !== "string") return { exists: false, isCondDef: false };
  const inCombine = hasKey(context.combineFuncDefTable, value);
  const inPipe = hasKey(context.pipeFuncDefTable, value);
  const inCond = hasKey(context.condFuncDefTable, value);
  return {
    exists: inCombine || inPipe || inCond,
    isCondDef: !inCombine && !inPipe && inCond,
  };
}

// ============================================================================
// Type environment
// ============================================================================

export function buildTypeEnvironment(context: UnvalidatedContext): TypeEnvironment {
  const env = new Map<ValueId | FuncId, BaseTypeSymbol>();
  if (context.valueTable) {
    for (const [valueId, value] of Object.entries(context.valueTable)) {
      if (hasSymbolProperty(value) && isStringAs<ValueId>(valueId)) {
        env.set(valueId, value.symbol);
      }
    }
  }
  return env;
}

export function inferFuncType(
  funcId: FuncId,
  context: UnvalidatedContext,
  visited: Set<FuncId> = new Set(),
): BaseTypeSymbol | null {
  if (visited.has(funcId)) return null;
  return inferGraphType("function", funcId, context);
}
