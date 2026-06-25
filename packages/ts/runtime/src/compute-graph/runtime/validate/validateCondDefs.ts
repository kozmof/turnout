import type { CombineDefineId, PipeDefineId, CondDefineId } from "../../types.js";
import type { UnvalidatedContext, ValidationState } from "./types.js";
import {
  isRecord,
  isStringAs,
  valueIdExistsInContext,
  funcIdExistsInContext,
  inferFuncType,
} from "./utils.js";

/**
 * Validates a CondFuncDefTable entry.
 */
export function validateCondDefEntry(
  defId: string,
  def: unknown,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `CondFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  if (!("conditionId" in entry) || !isRecord(entry.conditionId)) {
    state.errors.push({
      message: `CondFuncDefTable[${defId}]: Missing or invalid conditionId`,
      details: { defId },
    });
  } else {
    const conditionId = entry.conditionId;

    if (
      !("kind" in conditionId) ||
      typeof conditionId.kind !== "string" ||
      !("id" in conditionId) ||
      typeof conditionId.id !== "string"
    ) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Must include string kind and id`,
        details: { defId },
      });
    } else if (conditionId.kind !== "value" && conditionId.kind !== "func") {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].conditionId: Unknown kind "${conditionId.kind}"`,
        details: { defId, kind: conditionId.kind },
      });
    } else if (conditionId.kind === "value") {
      const id = conditionId.id;
      if (valueIdExistsInContext(id, context)) {
        state.referencedValues.add(id);
        const conditionType = state.typeEnv.get(id);
        if (conditionType && conditionType !== "boolean") {
          state.errors.push({
            message: `CondFuncDefTable[${defId}].conditionId: Condition value must be boolean, got "${conditionType}"`,
            details: { defId, conditionId: id, conditionType },
          });
        }
      } else {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].conditionId: Referenced ValueId ${id} does not exist`,
          details: { defId, conditionId: id },
        });
      }
    } else {
      const id = conditionId.id;
      if (funcIdExistsInContext(id, context)) {
        const inferredType = inferFuncType(id, context);
        if (inferredType && inferredType !== "boolean") {
          state.errors.push({
            message: `CondFuncDefTable[${defId}].conditionId: Function condition must return boolean, got "${inferredType}"`,
            details: { defId, conditionId: id, conditionType: inferredType },
          });
        }
      } else {
        state.errors.push({
          message: `CondFuncDefTable[${defId}].conditionId: Referenced FuncId ${id} does not exist`,
          details: { defId, conditionId: id },
        });
      }
    }
  }

  for (const branchKey of ["trueBranchId", "falseBranchId"] as const) {
    if (!(branchKey in entry) || typeof entry[branchKey] !== "string") {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].${branchKey}: Missing or invalid FuncId`,
        details: { defId, branchKey },
      });
      continue;
    }

    const branchId = entry[branchKey];
    if (!funcIdExistsInContext(branchId, context)) {
      state.errors.push({
        message: `CondFuncDefTable[${defId}].${branchKey}: Referenced FuncId ${branchId} does not exist`,
        details: { defId, [branchKey]: branchId },
      });
    }
  }

  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
    state.warnings.push({
      message: `CondFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}
