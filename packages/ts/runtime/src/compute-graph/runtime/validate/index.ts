import type { ExecutionContext, ValueId } from '../../types';
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
} from './types';
import { isRecord, isStringAs, hasKey, buildTypeEnvironment } from './utils';
import { validateFuncEntry, validateCombineDefEntry } from './validateCombineDefs';
import { validatePipeDefEntry } from './validatePipeDefs';
import { validateCondDefEntry } from './validateCondDefs';
import type { ValidationState } from './types';

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

function checkUnreferencedValues(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
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

function collectReturnIds(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.funcTable)) return;
  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (
      isRecord(funcEntry) &&
      'returnId' in funcEntry &&
      isStringAs<ValueId>(funcEntry.returnId)
    ) {
      const returnId = funcEntry.returnId;
      const existingOwner = state.returnIdToFuncId.get(returnId);
      if (existingOwner !== undefined) {
        state.errors.push({
          message: `FuncTable: duplicate returnId "${returnId}" shared by "${existingOwner}" and "${funcId}"`,
          details: { returnId, firstOwner: existingOwner, secondOwner: funcId },
        });
      } else {
        state.returnIdToFuncId.set(returnId, funcId);
        state.returnIds.add(returnId);
      }
    }
  }
}

function checkFunctionCycles(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.funcTable)) return;

  // state.returnIdToFuncId is already populated by collectReturnIds (which runs
  // before checkFunctionCycles), so we reuse it directly instead of rebuilding.
  const deps = new Map<string, Set<string>>();

  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    if (!isRecord(funcEntry)) continue;
    const funcDeps = new Set<string>();

    if ('argMap' in funcEntry && isRecord(funcEntry.argMap)) {
      for (const argId of Object.values(funcEntry.argMap)) {
        if (typeof argId !== 'string') continue;
        const producer = state.returnIdToFuncId.get(argId);
        if (producer) funcDeps.add(producer);
      }
    }

    if (
      'defId' in funcEntry &&
      typeof funcEntry.defId === 'string' &&
      hasKey(context.condFuncDefTable, funcEntry.defId)
    ) {
      const condDef = context.condFuncDefTable?.[funcEntry.defId];
      if (isRecord(condDef)) {
        if (
          'conditionId' in condDef &&
          isRecord(condDef.conditionId) &&
          'kind' in condDef.conditionId &&
          condDef.conditionId.kind === 'func' &&
          'id' in condDef.conditionId &&
          typeof condDef.conditionId.id === 'string'
        ) {
          funcDeps.add(condDef.conditionId.id);
        }
        if ('trueBranchId' in condDef && typeof condDef.trueBranchId === 'string') {
          funcDeps.add(condDef.trueBranchId);
        }
        if ('falseBranchId' in condDef && typeof condDef.falseBranchId === 'string') {
          funcDeps.add(condDef.falseBranchId);
        }
      }
    }

    deps.set(funcId, funcDeps);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const inner = cyclePath.slice(0, -1);
    const minIdx = inner.reduce((mi, v, i) => (v < inner[mi] ? i : mi), 0);
    const normalized = [...inner.slice(minIdx), ...inner.slice(0, minIdx), inner[minIdx]];
    const key = normalized.join(' -> ');
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `FuncTable: Cycle detected ${key}`,
      details: { cycle: normalized },
    });
  };

  const dfs = (funcId: string): void => {
    if (visited.has(funcId)) return;
    if (visiting.has(funcId)) {
      const start = stack.indexOf(funcId);
      const cycle = start >= 0 ? [...stack.slice(start), funcId] : [funcId, funcId];
      reportCycle(cycle);
      return;
    }
    visiting.add(funcId);
    stack.push(funcId);
    const funcDeps = deps.get(funcId);
    if (funcDeps) {
      for (const dep of funcDeps) {
        if (deps.has(dep)) dfs(dep);
      }
    }
    stack.pop();
    visiting.delete(funcId);
    visited.add(funcId);
  };

  for (const funcId of deps.keys()) {
    dfs(funcId);
  }
}

function checkPipeDefinitionCycles(
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(context.pipeFuncDefTable)) return;

  const deps = new Map<string, Set<string>>();
  for (const [defId, def] of Object.entries(context.pipeFuncDefTable)) {
    const defDeps = new Set<string>();
    if (isRecord(def) && 'sequence' in def && Array.isArray(def.sequence)) {
      for (const step of def.sequence) {
        if (
          !isRecord(step) ||
          !('defId' in step) ||
          typeof step.defId !== 'string'
        )
          continue;
        if (hasKey(context.pipeFuncDefTable, step.defId)) {
          defDeps.add(step.defId);
        }
      }
    }
    deps.set(defId, defDeps);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const reported = new Set<string>();

  const reportCycle = (cyclePath: string[]): void => {
    const key = cyclePath.join(' -> ');
    if (reported.has(key)) return;
    reported.add(key);
    state.errors.push({
      message: `PipeFuncDefTable: Cycle detected ${key}`,
      details: { cycle: cyclePath },
    });
  };

  const dfs = (defId: string): void => {
    if (visited.has(defId)) return;
    if (visiting.has(defId)) {
      const start = stack.indexOf(defId);
      const cycle = start >= 0 ? [...stack.slice(start), defId] : [defId, defId];
      reportCycle(cycle);
      return;
    }
    visiting.add(defId);
    stack.push(defId);
    const defDeps = deps.get(defId);
    if (defDeps) {
      for (const dep of defDeps) {
        if (deps.has(dep)) dfs(dep);
      }
    }
    stack.pop();
    visiting.delete(defId);
    visited.add(defId);
  };

  for (const defId of deps.keys()) {
    dfs(defId);
  }
}

function checkRequiredTables(
  context: UnvalidatedContext,
  state: ValidationState,
): context is ExecutionContext {
  const required = [
    'valueTable',
    'funcTable',
    'combineFuncDefTable',
    'pipeFuncDefTable',
    'condFuncDefTable',
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
    const errorMessages = result.errors
      .map((err) => `  - ${err.message}`)
      .join('\n');
    throw new Error(`ExecutionContext validation failed:\n${errorMessages}`);
  }
  return result.context;
}

export function isValidContext(
  context: UnvalidatedContext,
): context is ValidatedContext {
  const result = validateContext(context);
  return result.valid;
}
