import {
  ExecutionContext,
  ValueId,
  PlugDefineId,
  TapDefineId,
  CondDefineId,
} from '../types';
import { isFuncId, isPlugDefineId, isValueId } from '../typeGuards';
import {
  getTransformFnInputType,
  getTransformFnReturnType,
  getBinaryFnParamTypes,
  inferValueType,
  inferFuncReturnType,
} from './typeInference';

type AllPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? AllPartial<U>[]
    : T[P] extends object
    ? AllPartial<T[P]>
    : T[P];
};

/**
 * Type-safe helper to get entries from PlugFuncDefTable.
 * Returns entries that may have undefined values.
 */
function convertToUnsafeHypothesis<T extends object>(obj: T): [keyof T, AllPartial<T[keyof T]> | undefined][] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return Object.entries(obj) as [keyof T, AllPartial<T[keyof T]> | undefined][];
}

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

  // 5. Validate type safety for PlugFuncDefTable entries
  validatePlugFuncDefTableTypes(context, errors);

  // 6. Validate type safety for FuncTable entries
  validateFuncTableTypes(context, errors);

  // 7. Check for unreferenced values (warnings only)
  checkUnreferencedValues(context, warnings);

  // 8. Check for unreferenced definitions (warnings only)
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

    // Check if all arguments in argMap are valid ValueIds
    for (const [argName, argId] of Object.entries(argMap)) {
      const isValid =
        isValueId(argId, context.valueTable) ||
        allReturnIds.has(argId); // Will be computed during execution

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
  for (const [defId, def] of convertToUnsafeHypothesis(context.plugFuncDefTable)) {
    if (!def) continue;
    // Validate that args field exists and has 'a' and 'b' properties
    // args should contain InterfaceArgIds
    // We can't strictly validate InterfaceArgId format as they're just branded strings

    // Validate function names exist (runtime check would be needed for actual functions)
    // This is a structural check only
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
    // Check for empty sequence (also checked at runtime, but good to catch early)
    if (def.sequence.length === 0) {
      errors.push({
        type: 'error',
        message: `TapFuncDefTable[${defId}]: Sequence is empty`,
        details: { defId },
      });
    }

    // Validate each step in the sequence
    for (let i = 0; i < def.sequence.length; i++) {
      const step = def.sequence[i];

      // Validate that the referenced definition exists
      const stepDefExists =
        step.defId in context.plugFuncDefTable ||
        step.defId in context.tapFuncDefTable ||
        step.defId in context.condFuncDefTable;

      if (!stepDefExists) {
        errors.push({
          type: 'error',
          message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Referenced definition ${step.defId} does not exist`,
          details: { defId, stepIndex: i, stepDefId: step.defId },
        });
        continue; // Skip further validation for this step
      }

      // Validate argument bindings
      for (const [argName, binding] of Object.entries(step.argBindings)) {
        if (binding.source === 'input') {
          // Validate that the input argument exists in TapFunc args
          if (!(binding.argName in def.args)) {
            errors.push({
              type: 'error',
              message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Argument binding for '${argName}' references undefined TapFunc input '${binding.argName}'`,
              details: { defId, stepIndex: i, argName, inputArgName: binding.argName },
            });
          }
        } else if (binding.source === 'step') {
          // Validate that step index is within bounds
          if (binding.stepIndex < 0 || binding.stepIndex >= i) {
            errors.push({
              type: 'error',
              message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Argument binding for '${argName}' references invalid step index ${String(binding.stepIndex)} (must be < ${String(i)})`,
              details: { defId, stepIndex: i, argName, referencedStepIndex: binding.stepIndex },
            });
          }
        } else {
          // binding.source === 'value'
          // Validate that the value exists in ValueTable
          if (!isValueId(binding.valueId, context.valueTable)) {
            errors.push({
              type: 'error',
              message: `TapFuncDefTable[${defId}].sequence[${String(i)}]: Argument binding for '${argName}' references non-existent ValueId ${String(binding.valueId)}`,
              details: { defId, stepIndex: i, argName, valueId: binding.valueId },
            });
          }
        }
      }
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

/**
 * Validates type safety for PlugFuncDefTable entries.
 *
 * Checks that:
 * - Transform functions are valid and recognized
 * - Transform function output types match binary function input types
 *
 * Note: This does not validate array binary functions (binaryFnArray::*)
 * because they require element type information from runtime values,
 * which is complex to validate statically. The design also does not
 * support nested arrays (array elements cannot be arrays).
 */
function validatePlugFuncDefTableTypes(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  // const plugFuncDefTable: DeepPartial<PlugFuncDefTable> = context.plugFuncDefTable;
  for (const [defId, def] of convertToUnsafeHypothesis(context.plugFuncDefTable)) {
    // Skip if def is undefined or transformFn is not properly defined
    if (!def?.transformFn?.a?.name || !def.transformFn.b?.name) {
      continue;
    }

    // Validate that transform function 'a' is compatible with its argument type
    const transformAInputType = getTransformFnInputType(def.transformFn.a.name);
    const transformAReturnType = getTransformFnReturnType(def.transformFn.a.name);

    // Validate that transform function 'b' is compatible with its argument type
    const transformBInputType = getTransformFnInputType(def.transformFn.b.name);
    const transformBReturnType = getTransformFnReturnType(def.transformFn.b.name);

    if (!transformAInputType || !transformAReturnType) {
      errors.push({
        type: 'error',
        message: `PlugFuncDefTable[${defId}].transformFn.a: Invalid or unknown transform function "${def.transformFn.a.name}"`,
        details: { defId, transformFn: def.transformFn.a.name },
      });
    }

    if (!transformBInputType || !transformBReturnType) {
      errors.push({
        type: 'error',
        message: `PlugFuncDefTable[${defId}].transformFn.b: Invalid or unknown transform function "${def.transformFn.b.name}"`,
        details: { defId, transformFn: def.transformFn.b.name },
      });
    }

    // Validate that the binary function's parameter types match the transform outputs
    if (transformAReturnType && transformBReturnType && def.name) {
      const binaryParamTypes = getBinaryFnParamTypes(def.name);

      if (binaryParamTypes) {
        const [expectedParamA, expectedParamB] = binaryParamTypes;

        if (transformAReturnType !== expectedParamA) {
          errors.push({
            type: 'error',
            message: `PlugFuncDefTable[${defId}]: Transform function 'a' returns "${transformAReturnType}" but binary function "${def.name}" expects "${expectedParamA}" for first parameter`,
            details: {
              defId,
              transformFn: def.transformFn.a.name,
              transformReturnType: transformAReturnType,
              binaryFn: def.name,
              expectedType: expectedParamA,
            },
          });
        }

        if (transformBReturnType !== expectedParamB) {
          errors.push({
            type: 'error',
            message: `PlugFuncDefTable[${defId}]: Transform function 'b' returns "${transformBReturnType}" but binary function "${def.name}" expects "${expectedParamB}" for second parameter`,
            details: {
              defId,
              transformFn: def.transformFn.b.name,
              transformReturnType: transformBReturnType,
              binaryFn: def.name,
              expectedType: expectedParamB,
            },
          });
        }
      }
    }
  }
}

/**
 * Validates type safety for FuncTable entries.
 *
 * Checks that:
 * - Argument types in argMap match the expected input types of transform functions
 *
 * Note: Only validates PlugFunc entries. TapFunc and CondFunc have different
 * validation needs that are not yet implemented. Array binary functions are
 * also not validated due to the complexity of element type checking.
 */
function validateFuncTableTypes(
  context: ExecutionContext,
  errors: ValidationError[]
): void {
  for (const [funcId, funcEntry] of Object.entries(context.funcTable)) {
    const { defId, argMap } = funcEntry;

    // Only validate PlugFunc types (TapFunc and CondFunc have different validation needs)
    if (isPlugDefineId(defId, context.plugFuncDefTable)) {
      const def = context.plugFuncDefTable[defId];

      // Check argument 'a' type compatibility
      const argAId = argMap['a'];
      if (argAId) {
        let argAType = inferValueType(argAId, context);
        if (!argAType && isFuncId(argAId, context.funcTable)) {
          argAType = inferFuncReturnType(argAId, context);
        }
        const expectedAType = getTransformFnInputType(def.transformFn.a.name);

        if (argAType && expectedAType && argAType !== expectedAType) {
          errors.push({
            type: 'error',
            message: `FuncTable[${funcId}].argMap['a']: Argument has type "${argAType}" but transform function "${def.transformFn.a.name}" expects "${expectedAType}"`,
            details: {
              funcId,
              argId: argAId,
              argType: argAType,
              transformFn: def.transformFn.a.name,
              expectedType: expectedAType,
            },
          });
        }
      }

      // Check argument 'b' type compatibility
      const argBId = argMap['b'];
      if (argBId) {
        let argBType = inferValueType(argBId, context);
        if (!argBType && isFuncId(argBId, context.funcTable)) {
          argBType = inferFuncReturnType(argBId, context);
        }
        const expectedBType = getTransformFnInputType(def.transformFn.b.name);

        if (argBType && expectedBType && argBType !== expectedBType) {
          errors.push({
            type: 'error',
            message: `FuncTable[${funcId}].argMap['b']: Argument has type "${argBType}" but transform function "${def.transformFn.b.name}" expects "${expectedBType}"`,
            details: {
              funcId,
              argId: argBId,
              argType: argBType,
              transformFn: def.transformFn.b.name,
              expectedType: expectedBType,
            },
          });
        }
      }
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
