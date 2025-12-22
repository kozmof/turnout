import {
  ExecutionContext,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
} from '../types';
import { isFuncId, isValueId } from '../typeGuards';

export type ValidationError = {
  readonly type: 'error';
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ValidationWarning = {
  readonly type: 'warning';
  readonly message: string;
  readonly details?: Record<string, unknown>;
};

export type ValidationResult = {
  readonly valid: boolean;
  readonly errors: ValidationError[];
  readonly warnings: ValidationWarning[];
};

/**
 * Validates the logical integrity of an ExecutionContext.
 * This performs "compile-time" checks to catch issues before execution:
 * - All referenced IDs exist in their respective tables
 * - Function definitions reference valid argument IDs
 * - No dangling references
 * - Type consistency
 */
export function validateContext(context: ExecutionContext): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Validate FuncTable entries
  validateFuncTable(context, errors);

  // 2. Validate PlugFuncDefTable entries
  validatePlugFuncDefTable(context, errors);

  // 3. Validate TapFuncDefTable entries
  validateTapFuncDefTable(context, errors);

  // 4. Validate CondFuncDefTable entries
  validateCondFuncDefTable(context, errors);

  // 5. Check for unreferenced values (warnings only)
  checkUnreferencedValues(context, warnings);

  // 6. Check for unreferenced definitions (warnings only)
  checkUnreferencedDefinitions(context, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateFuncTable(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  // Build a set of all return IDs for quick lookup
  const allReturnIds = new Set<ValueId>();
  for (const funcEntry of Object.values(context.funcTable)) {
    allReturnIds.add(funcEntry.returnId);
  }

  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    const { defId, argMap } = funcEntry;

    // Check if definition exists
    const defExists =
      defId in context.plugFuncDefTable ||
      defId in context.tapFuncDefTable ||
      defId in context.condFuncDefTable;

    if (!defExists) {
      errors.push({
        type: 'error',
        message: `FuncTable[${funcId}]: Definition ${defId} does not exist`,
        details: { funcId, defId },
      });
    }

    // Check if returnId exists in ValueTable (or will be created)
    // Note: returnId may not exist yet if it will be computed
    // This is not an error, just informational

    // Check if all arguments in argMap are valid IDs
    for (const [argName, argId] of Object.entries(argMap)) {
      const isValid =
        isFuncId(argId, context.funcTable) ||
        isValueId(argId, context.valueTable) ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        allReturnIds.has(argId as ValueId); // Will be computed during execution

      if (!isValid) {
        errors.push({
          type: 'error',
          message: `FuncTable[${funcId}].argMap['${argName}']: Referenced ID ${String(argId)} does not exist`,
          details: { funcId, argName, argId },
        });
      }
    }
  }
}

function validatePlugFuncDefTable(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  for (const [defId, def] of Object.entries(context.plugFuncDefTable)) {
    // Validate that argument references are interface args or other plug defs
    for (const argId of Object.values(def.args)) {
      // argId should be either InterfaceArgId or PlugDefineId
      // We can't strictly validate InterfaceArgId as they're just branded strings
      // But we can check if it looks like a PlugDefineId
      if (typeof argId === 'string' && argId in context.plugFuncDefTable) {
        // It's a nested PlugFunc - this is valid
        continue;
      }

      // Otherwise it should be an InterfaceArgId - we trust it's valid
      // No validation error, but could add warning if needed
    }

    // Validate function names exist (runtime check would be needed for actual functions)
    // This is a structural check only
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!def.name || typeof def.name !== 'string') {
      errors.push({
        type: 'error',
        message: `PlugFuncDefTable[${defId}]: Invalid or missing function name`,
        details: { defId, name: def.name },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!def.transformFn || !def.transformFn.a || !def.transformFn.b ||
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        !def.transformFn.a.name || !def.transformFn.b.name) {
      errors.push({
        type: 'error',
        message: `PlugFuncDefTable[${defId}]: Missing transform function definitions`,
        details: { defId },
      });
    }
  }
}

function validateTapFuncDefTable(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  for (const [defId, def] of Object.entries(context.tapFuncDefTable)) {
    // Validate sequence contains valid FuncIds
    for (const stepFuncId of def.sequence) {
      if (!isFuncId(stepFuncId, context.funcTable)) {
        errors.push({
          type: 'error',
          message: `TapFuncDefTable[${defId}].sequence: Referenced FuncId ${String(stepFuncId)} does not exist`,
          details: { defId, stepFuncId },
        });
      }
    }

    // Check for empty sequence (also checked at runtime, but good to catch early)
    if (def.sequence.length === 0) {
      errors.push({
        type: 'error',
        message: `TapFuncDefTable[${defId}]: Sequence is empty`,
        details: { defId },
      });
    }
  }
}

function validateCondFuncDefTable(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  for (const [defId, def] of Object.entries(context.condFuncDefTable)) {
    // Validate condition ID exists
    const conditionIdValid =
      isFuncId(def.conditionId, context.funcTable) ||
      isValueId(def.conditionId, context.valueTable);

    if (!conditionIdValid) {
      errors.push({
        type: 'error',
        message: `CondFuncDefTable[${defId}].conditionId: Referenced ID ${String(def.conditionId)} does not exist`,
        details: { defId, conditionId: def.conditionId },
      });
    }

    // Validate branch IDs exist
    if (!isFuncId(def.trueBranchId, context.funcTable)) {
      errors.push({
        type: 'error',
        message: `CondFuncDefTable[${defId}].trueBranchId: Referenced FuncId ${String(def.trueBranchId)} does not exist`,
        details: { defId, trueBranchId: def.trueBranchId },
      });
    }

    if (!isFuncId(def.falseBranchId, context.funcTable)) {
      errors.push({
        type: 'error',
        message: `CondFuncDefTable[${defId}].falseBranchId: Referenced FuncId ${String(def.falseBranchId)} does not exist`,
        details: { defId, falseBranchId: def.falseBranchId },
      });
    }
  }
}

function checkUnreferencedValues(
  context: ExecutionContext,
  warnings: ValidationWarning[]
): void {
  const referencedValueIds = new Set<ValueId>();

  // Collect all referenced ValueIds from FuncTable argMaps
  for (const funcEntry of Object.values(context.funcTable)) {
    for (const argId of Object.values(funcEntry.argMap)) {
      if (isValueId(argId, context.valueTable)) {
        referencedValueIds.add(argId);
      }
    }
  }

  // Collect referenced ValueIds from CondFuncDefTable conditions
  for (const condDef of Object.values(context.condFuncDefTable)) {
    if (isValueId(condDef.conditionId, context.valueTable)) {
      referencedValueIds.add(condDef.conditionId);
    }
  }

  // Check for unreferenced values
  for (const valueId of Object.keys(context.valueTable)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if (!referencedValueIds.has(valueId as ValueId)) {
      warnings.push({
        type: 'warning',
        message: `ValueTable[${valueId}]: Value is never referenced`,
        details: { valueId },
      });
    }
  }
}

function checkUnreferencedDefinitions(
  context: ExecutionContext,
  warnings: ValidationWarning[]
): void {
  const referencedDefIds = new Set<
    PlugDefineId | TapDefineId | CondDefineId
  >();

  // Collect all referenced definition IDs from FuncTable
  for (const funcEntry of Object.values(context.funcTable)) {
    referencedDefIds.add(funcEntry.defId);
  }

  // Check PlugFuncDefTable
  for (const defId of Object.keys(context.plugFuncDefTable)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if (!referencedDefIds.has(defId as PlugDefineId)) {
      warnings.push({
        type: 'warning',
        message: `PlugFuncDefTable[${defId}]: Definition is never used`,
        details: { defId },
      });
    }
  }

  // Check TapFuncDefTable
  for (const defId of Object.keys(context.tapFuncDefTable)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if (!referencedDefIds.has(defId as TapDefineId)) {
      warnings.push({
        type: 'warning',
        message: `TapFuncDefTable[${defId}]: Definition is never used`,
        details: { defId },
      });
    }
  }

  // Check CondFuncDefTable
  for (const defId of Object.keys(context.condFuncDefTable)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    if (!referencedDefIds.has(defId as CondDefineId)) {
      warnings.push({
        type: 'warning',
        message: `CondFuncDefTable[${defId}]: Definition is never used`,
        details: { defId },
      });
    }
  }
}

/**
 * Validates context and throws an error if invalid.
 * Useful for strict validation before execution.
 */
export function assertValidContext(context: ExecutionContext): void {
  const result = validateContext(context);

  if (!result.valid) {
    const errorMessages = result.errors
      .map(err => `  - ${err.message}`)
      .join('\n');

    throw new Error(
      `ExecutionContext validation failed:\n${errorMessages}`
    );
  }
}
