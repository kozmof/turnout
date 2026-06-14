import type {
  ValueId,
  FuncId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  BinaryFnNames,
} from "../../types";
import type { BaseTypeSymbol } from "../../../state-control/value";
import { getBinaryFnReturnType } from "../typeInference";
import type { UnvalidatedContext, TypeEnvironment } from "./types";
import { VALID_BASE_TYPE_SYMBOLS } from "./types";

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

export function isCombineDefWithBinaryFnName(value: unknown): value is { name: BinaryFnNames } {
  if (!(value && typeof value === "object" && "name" in value && typeof value.name === "string")) {
    return false;
  }
  // getBinaryFnReturnType is the runtime proof that the string is a BinaryFnNames member.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return getBinaryFnReturnType(value.name as BinaryFnNames) !== null;
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

export function hasKey(table: unknown, key: string): boolean {
  return isRecord(table) && key in table;
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
  const funcEntry = context.funcTable?.[funcId];
  if (!funcEntry || typeof funcEntry !== "object") return null;
  visited.add(funcId);

  const defId = "defId" in funcEntry ? funcEntry.defId : undefined;
  if (!defId || typeof defId !== "string") return null;

  const combineDef = context.combineFuncDefTable?.[defId];
  if (isCombineDefWithBinaryFnName(combineDef)) {
    return getBinaryFnReturnType(combineDef.name);
  }

  const pipeDef = context.pipeFuncDefTable?.[defId];
  if (isPipeDefWithSequence(pipeDef)) {
    if (pipeDef.sequence.length === 0) return null;
    const lastStep = pipeDef.sequence[pipeDef.sequence.length - 1];
    if (lastStep && typeof lastStep === "object" && "defId" in lastStep) {
      if (typeof lastStep.defId !== "string") return null;
      const lastStepDefId = lastStep.defId;
      const lastStepCombineDef = context.combineFuncDefTable?.[lastStepDefId];
      if (isCombineDefWithBinaryFnName(lastStepCombineDef)) {
        return getBinaryFnReturnType(lastStepCombineDef.name);
      }
    }
    return null;
  }

  return null;
}
