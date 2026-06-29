import type { ExecutionContext, ValueId } from "../../types.js";
import {
  type UnvalidatedContext,
  type ValidationResult,
  type ValidatedContext,
  type ValidationError,
  type ValidationWarning,
  type TypeEnvironment,
  isValidationSuccess,
  createValidatedContext,
  createValidationState,
} from "./types.js";
import { isRecord, isStringAs, hasKey, buildTypeEnvironment } from "./utils.js";
import { validateFuncEntry, validateCombineDefEntry } from "./validateCombineDefs.js";
import { validatePipeDefEntry } from "./validatePipeDefs.js";
import { validateCondDefEntry } from "./validateCondDefs.js";
import type { ValidationState } from "./types.js";
import { MAX_GRAPH_NODES } from "../limits.js";

export type {
  UnvalidatedContext,
  ValidatedContext,
  ValidationError,
  ValidationWarning,
  ValidationResult,
  TypeEnvironment,
};
export { isValidationSuccess };

// ============================================================================
// Cross-cutting checks
// ============================================================================

function checkUnreferencedValues(context: UnvalidatedContext, state: ValidationState): void {
  if (!isRecord(context.valueTable)) return;
  for (const valueId of Object.keys(context.valueTable)) {
    if (isStringAs<ValueId>(valueId) && !state.referencedValues.has(valueId)) {
      state.warnings.push({
        message: `ValueTable[${valueId}]: Value is never referenced`,
        details: { valueId },
      });
    }
  }
}

function collectReturnIds(context: UnvalidatedContext, state: ValidationState): void {
  if (!isRecord(context.funcTable)) return;
  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (isRecord(funcEntry) && "returnId" in funcEntry && isStringAs<ValueId>(funcEntry.returnId)) {
      const returnId = funcEntry.returnId;
      const existingOwner = state.returnIdToFuncId.get(returnId);
      if (existingOwner === undefined) {
        state.returnIdToFuncId.set(returnId, funcId);
        state.returnIds.add(returnId);
      } else {
        state.errors.push({
          message: `FuncTable: duplicate returnId "${returnId}" shared by "${existingOwner}" and "${funcId}"`,
          details: { returnId, firstOwner: existingOwner, secondOwner: funcId },
        });
      }
    }
  }
}

// Iterative DFS cycle detection shared by the funcTable and pipeFuncDefTable
// passes. Uses an explicit work stack (one frame per node, each holding an
// iterator over that node's dependencies) so deep dependency chains cannot
// overflow the native call stack. The `visited` / `visiting` / `stack` sets are
// shared across all roots, exactly as in the recursive form this replaces:
// `visiting` is the current ancestor chain, `stack` records its order for cycle
// reporting, and `visited` marks fully-explored nodes.
function detectCycles(
  deps: ReadonlyMap<string, ReadonlySet<string>>,
  reportCycle: (cyclePath: string[]) => void,
): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const work: { node: string; iter: Iterator<string> }[] = [];

  // Mirrors the head of the former recursive `dfs`: returns true only when a new
  // frame was pushed (i.e. we descended into `node`). Returns false when `node`
  // is already fully explored or is a back-edge (cycle), reporting the latter.
  const enter = (node: string): boolean => {
    if (visited.has(node)) return false;
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      const cycle = start >= 0 ? [...stack.slice(start), node] : [node, node];
      reportCycle(cycle);
      return false;
    }
    visiting.add(node);
    stack.push(node);
    work.push({ node, iter: (deps.get(node) ?? new Set<string>()).values() });
    return true;
  };

  for (const root of deps.keys()) {
    enter(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame === undefined) break;
      let descended = false;
      let res = frame.iter.next();
      while (!res.done) {
        const dep = res.value;
        if (deps.has(dep) && enter(dep)) {
          descended = true;
          break;
        }
        res = frame.iter.next();
      }
      if (!descended) {
        work.pop();
        stack.pop();
        visiting.delete(frame.node);
        visited.add(frame.node);
      }
    }
  }
}

function checkFunctionCycles(context: UnvalidatedContext, state: ValidationState): void {
  if (!isRecord(context.funcTable)) return;

  // state.returnIdToFuncId is already populated by collectReturnIds (which runs
  // before checkFunctionCycles), so we reuse it directly instead of rebuilding.
  const deps = new Map<string, Set<string>>();

  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (!isRecord(funcEntry)) continue;
    const funcDeps = new Set<string>();

    if ("argMap" in funcEntry && isRecord(funcEntry.argMap)) {
      for (const argId of Object.values(funcEntry.argMap)) {
        if (typeof argId !== "string") continue;
        const producer = state.returnIdToFuncId.get(argId);
        if (producer) funcDeps.add(producer);
      }
    }

    if (
      "defId" in funcEntry &&
      typeof funcEntry.defId === "string" &&
      hasKey(context.condFuncDefTable, funcEntry.defId)
    ) {
      const condDef = context.condFuncDefTable?.[funcEntry.defId];
      if (isRecord(condDef)) {
        if (
          "conditionId" in condDef &&
          isRecord(condDef.conditionId) &&
          "kind" in condDef.conditionId &&
          condDef.conditionId.kind === "func" &&
          "id" in condDef.conditionId &&
          typeof condDef.conditionId.id === "string"
        ) {
          funcDeps.add(condDef.conditionId.id);
        }
        if ("trueBranchId" in condDef && typeof condDef.trueBranchId === "string") {
          funcDeps.add(condDef.trueBranchId);
        }
        if ("falseBranchId" in condDef && typeof condDef.falseBranchId === "string") {
          funcDeps.add(condDef.falseBranchId);
        }
      }
    }

    deps.set(funcId, funcDeps);
  }

  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const inner = cyclePath.slice(0, -1);
    const first = inner[0];
    if (first === undefined) return;
    let minValue = first;
    let minIdx = 0;
    inner.forEach((value, index) => {
      if (value < minValue) {
        minValue = value;
        minIdx = index;
      }
    });
    const normalized = [...inner.slice(minIdx), ...inner.slice(0, minIdx), minValue];
    const key = normalized.join(" -> ");
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `FuncTable: Cycle detected ${key}`,
      details: { cycle: normalized },
    });
  };

  detectCycles(deps, reportCycle);
}

function checkPipeDefinitionCycles(context: UnvalidatedContext, state: ValidationState): void {
  if (!isRecord(context.pipeFuncDefTable)) return;

  const deps = new Map<string, Set<string>>();
  for (const [defId, def] of Object.entries(context.pipeFuncDefTable)) {
    const defDeps = new Set<string>();
    if (isRecord(def) && "sequence" in def && Array.isArray(def.sequence)) {
      for (const step of def.sequence) {
        if (!isRecord(step) || !("defId" in step) || typeof step.defId !== "string") continue;
        if (hasKey(context.pipeFuncDefTable, step.defId)) {
          defDeps.add(step.defId);
        }
      }
    }
    deps.set(defId, defDeps);
  }

  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const key = cyclePath.join(" -> ");
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `PipeFuncDefTable: Cycle detected ${key}`,
      details: { cycle: cyclePath },
    });
  };

  detectCycles(deps, reportCycle);
}

function checkRequiredTables(
  context: UnvalidatedContext,
  state: ValidationState,
): context is ExecutionContext {
  const required = [
    "valueTable",
    "funcTable",
    "combineFuncDefTable",
    "pipeFuncDefTable",
    "condFuncDefTable",
  ] as const;

  let hasAllRequiredTables = true;

  for (const tableName of required) {
    const table = context[tableName];
    if (table === undefined) {
      hasAllRequiredTables = false;
      state.errors.push({
        message: `ExecutionContext is missing required table: ${tableName}`,
        details: { tableName },
      });
      continue;
    }
    if (!isRecord(table)) {
      hasAllRequiredTables = false;
      state.errors.push({
        message: `ExecutionContext table ${tableName} must be an object`,
        details: { tableName, actualType: typeof table },
      });
    }
  }

  return hasAllRequiredTables;
}

// Reject models whose total node count exceeds the budget before running any
// graph traversal. This bounds both the work the validator does and the depth
// every downstream (iterative) traversal can reach, so a single oversized model
// cannot exhaust memory. Called only after checkRequiredTables confirms every
// table is a record.
function checkGraphSizeBudget(context: ExecutionContext, state: ValidationState): boolean {
  const totalNodes =
    Object.keys(context.valueTable).length +
    Object.keys(context.funcTable).length +
    Object.keys(context.combineFuncDefTable).length +
    Object.keys(context.pipeFuncDefTable).length +
    Object.keys(context.condFuncDefTable).length;

  if (totalNodes > MAX_GRAPH_NODES) {
    state.errors.push({
      message: `ExecutionContext is too large: ${totalNodes} total table entries exceeds the limit of ${MAX_GRAPH_NODES}`,
      details: { totalNodes, limit: MAX_GRAPH_NODES },
    });
    return false;
  }
  return true;
}

// ============================================================================
// Public API
// ============================================================================

export function validateContext(context: UnvalidatedContext): ValidationResult {
  const state = createValidationState();

  const hasAllRequiredTables = checkRequiredTables(context, state);
  if (!hasAllRequiredTables || state.errors.length > 0) {
    return {
      valid: false,
      errors: state.errors,
      warnings: state.warnings,
    };
  }

  // Enforce the size budget before any (potentially deep) traversal below.
  if (!checkGraphSizeBudget(context, state)) {
    return {
      valid: false,
      errors: state.errors,
      warnings: state.warnings,
    };
  }

  const initialTypeEnv = buildTypeEnvironment(context);
  for (const [id, type] of initialTypeEnv) {
    state.typeEnv.set(id, type);
  }

  collectReturnIds(context, state);

  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    validateFuncEntry(funcId, funcEntry, context, state);
  }

  for (const [defId, def] of Object.entries(context.combineFuncDefTable)) {
    validateCombineDefEntry(defId, def, state);
  }

  for (const [defId, def] of Object.entries(context.pipeFuncDefTable)) {
    validatePipeDefEntry(defId, def, context, state);
  }

  for (const [defId, def] of Object.entries(context.condFuncDefTable)) {
    validateCondDefEntry(defId, def, context, state);
  }

  checkFunctionCycles(context, state);
  checkPipeDefinitionCycles(context, state);
  checkUnreferencedValues(context, state);

  if (state.errors.length === 0) {
    return {
      valid: true,
      context: createValidatedContext(context),
      warnings: state.warnings,
      errors: [],
    };
  } else {
    return {
      valid: false,
      errors: state.errors,
      warnings: state.warnings,
    };
  }
}

export function assertValidContext(context: UnvalidatedContext): ValidatedContext {
  const result = validateContext(context);
  if (!result.valid) {
    const errorMessages = result.errors.map((err) => `  - ${err.message}`).join("\n");
    throw new Error(`ExecutionContext validation failed:\n${errorMessages}`);
  }
  return result.context;
}

export function isValidContext(context: UnvalidatedContext): context is ValidatedContext {
  const result = validateContext(context);
  return result.valid;
}
