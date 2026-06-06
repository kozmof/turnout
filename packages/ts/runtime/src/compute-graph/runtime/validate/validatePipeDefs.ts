import type {
  ValueId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
  PipeArgBinding,
  ValueTable,
} from '../../types';
import { createPipeArgName, createValueId } from '../../idValidation';
import type { UnvalidatedContext, ValidationState, ValidationError } from './types';
import { isRecord, isStringAs, hasKey, pipeStepDefIdExistsInContext } from './utils';

// ============================================================================
// Binding validation
// ============================================================================

type BindingValidationContext = {
  readonly stepIndex: number;
  readonly pipeDefArgs: ReadonlySet<string>;
  readonly valueTable: Partial<ValueTable>;
  readonly defId: string;
  readonly referencedValues: Set<ValueId>;
};

type BindingValidator = (
  binding: PipeArgBinding,
  argName: string,
  context: BindingValidationContext,
) => ValidationError | null;

function validateInputBinding(
  binding: Extract<PipeArgBinding, { source: 'input' }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (!context.pipeDefArgs.has(binding.argName)) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references undefined PipeFunc input '${binding.argName}'`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        inputArgName: binding.argName,
      },
    };
  }
  return null;
}

function validateStepBinding(
  binding: Extract<PipeArgBinding, { source: 'step' }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (
    !Number.isInteger(binding.stepIndex) ||
    binding.stepIndex < 0 ||
    binding.stepIndex >= context.stepIndex
  ) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references invalid step index ${String(binding.stepIndex)} (must be < ${String(context.stepIndex)})`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        referencedStepIndex: binding.stepIndex,
      },
    };
  }
  return null;
}

function validateValueBinding(
  binding: Extract<PipeArgBinding, { source: 'value' }>,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  if (!hasKey(context.valueTable, binding.id)) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' references non-existent ValueId ${String(binding.id)}`,
      details: {
        defId: context.defId,
        stepIndex: context.stepIndex,
        argName,
        valueId: binding.id,
      },
    };
  }
  context.referencedValues.add(binding.id);
  return null;
}

function parseBinding(
  binding: unknown,
  defId: string,
  stepIndex: number,
  argName: string,
): { binding?: PipeArgBinding; error?: ValidationError } {
  if (
    !isRecord(binding) ||
    !('source' in binding) ||
    typeof binding.source !== 'string'
  ) {
    return {
      error: {
        message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: Argument binding for '${argName}' is invalid`,
        details: { defId, stepIndex, argName },
      },
    };
  }

  switch (binding.source) {
    case 'input':
      if (
        !('argName' in binding) ||
        typeof binding.argName !== 'string' ||
        binding.argName.length === 0
      ) {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'input' binding for '${argName}' must include string argName`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: 'input',
          argName: createPipeArgName(binding.argName),
        },
      };
    case 'step':
      if (!('stepIndex' in binding) || typeof binding.stepIndex !== 'number') {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'step' binding for '${argName}' must include numeric stepIndex`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: 'step',
          stepIndex: binding.stepIndex,
        },
      };
    case 'value':
      if (
        !('id' in binding) ||
        typeof binding.id !== 'string' ||
        binding.id.length === 0
      ) {
        return {
          error: {
            message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: 'value' binding for '${argName}' must include string id`,
            details: { defId, stepIndex, argName },
          },
        };
      }
      return {
        binding: {
          source: 'value',
          id: createValueId(binding.id),
        },
      };
    default:
      return {
        error: {
          message: `PipeFuncDefTable[${defId}].sequence[${String(stepIndex)}]: Argument binding for '${argName}' has unknown source "${binding.source}"`,
          details: { defId, stepIndex, argName, source: binding.source },
        },
      };
  }
}

const BINDING_VALIDATORS: Record<PipeArgBinding['source'], BindingValidator> = {
  input: validateInputBinding as BindingValidator,
  step: validateStepBinding as BindingValidator,
  value: validateValueBinding as BindingValidator,
};

function validateBinding(
  binding: PipeArgBinding,
  argName: string,
  context: BindingValidationContext,
): ValidationError | null {
  const validator = BINDING_VALIDATORS[binding.source];
  if (!validator) {
    return {
      message: `PipeFuncDefTable[${context.defId}].sequence[${String(context.stepIndex)}]: Argument binding for '${argName}' has unknown source "${(binding as { source: string }).source}"`,
      details: { defId: context.defId, stepIndex: context.stepIndex, argName },
    };
  }
  return validator(binding, argName, context);
}

// ============================================================================
// PipeFuncDef entry validator
// ============================================================================

/**
 * Validates a PipeFuncDefTable entry.
 */
export function validatePipeDefEntry(
  defId: string,
  def: unknown,
  context: UnvalidatedContext,
  state: ValidationState,
): void {
  if (!isRecord(def)) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Invalid entry`,
      details: { defId },
    });
    return;
  }

  const entry = def;

  if (!('sequence' in entry) || !Array.isArray(entry.sequence)) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Missing or invalid sequence`,
      details: { defId },
    });
    return;
  }

  if (entry.sequence.length === 0) {
    state.errors.push({
      message: `PipeFuncDefTable[${defId}]: Sequence is empty`,
      details: { defId },
    });
    return;
  }

  const pipeDefArgNames: string[] = [];
  if ('args' in entry) {
    const rawArgs: unknown = entry.args;
    if (Array.isArray(rawArgs)) {
      for (let i = 0; i < rawArgs.length; i++) {
        const argName: unknown = rawArgs[i];
        if (typeof argName !== 'string') {
          state.errors.push({
            message: `PipeFuncDefTable[${defId}].args[${String(i)}]: argument name must be a string`,
            details: { defId, argIndex: i, argName },
          });
          continue;
        }
        pipeDefArgNames.push(argName);
      }
    } else if (isRecord(rawArgs)) {
      // Backward compatibility: accept legacy map-shaped args and treat keys as arg names.
      pipeDefArgNames.push(...Object.keys(rawArgs));
    } else {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}]: 'args' must be an array of strings`,
        details: { defId, args: rawArgs },
      });
    }
  }
  const pipeDefArgs = new Set(pipeDefArgNames);

  for (let i = 0; i < entry.sequence.length; i++) {
    const step = entry.sequence[i];
    if (!isRecord(step)) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Step must be an object`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepObj = step;

    if (!('defId' in stepObj) || typeof stepObj.defId !== 'string') {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Missing step defId`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const stepDefId = stepObj.defId;
    const stepDefCheck = pipeStepDefIdExistsInContext(stepDefId, context);
    if (!stepDefCheck.exists) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Referenced definition ${stepDefId} does not exist`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }
    if (stepDefCheck.isCondDef) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: CondFunc definition ${stepDefId} cannot be used as a pipe step; only combine and pipe definitions are supported`,
        details: { defId, stepIndex: i, stepDefId },
      });
      continue;
    }

    if (!('argBindings' in stepObj) || !isRecord(stepObj.argBindings)) {
      state.errors.push({
        message: `PipeFuncDefTable[${defId}].sequence[${String(i)}]: Missing or invalid argBindings`,
        details: { defId, stepIndex: i },
      });
      continue;
    }

    const argBindings = stepObj.argBindings;
    for (const [argName, rawBinding] of Object.entries(argBindings)) {
      const parsed = parseBinding(rawBinding, defId, i, argName);
      if (parsed.error) {
        state.errors.push(parsed.error);
        continue;
      }
      if (!parsed.binding) continue;

      const validationContext: BindingValidationContext = {
        stepIndex: i,
        pipeDefArgs,
        valueTable: context.valueTable ?? {},
        defId,
        referencedValues: state.referencedValues,
      };

      const error = validateBinding(parsed.binding, argName, validationContext);
      if (error) {
        state.errors.push(error);
      }
    }
  }

  if (
    isStringAs<CombineDefineId | PipeDefineId | CondDefineId>(defId) &&
    !state.referencedDefs.has(defId)
  ) {
    state.warnings.push({
      message: `PipeFuncDefTable[${defId}]: Definition is never used`,
      details: { defId },
    });
  }
}
