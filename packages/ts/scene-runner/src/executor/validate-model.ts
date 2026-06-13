import type { TurnModel, ProgModel, BindingModel } from '../types/turnout-model_pb.js';

/**
 * Validate the structural invariants of a TurnModel that cannot be caught by
 * the proto parser (which only checks field types, not semantic constraints).
 *
 * Returns an array of error strings — empty means the model is structurally
 * valid. Callers should throw when the array is non-empty rather than
 * proceeding to execute a malformed model.
 *
 * Version checking is intentionally omitted here because `migrateModel` already
 * handles it with clear error messages before this function is called.
 */
export function validateModel(model: TurnModel): string[] {
  const errors: string[] = [];

  for (const scene of model.scenes) {
    const seenIds = new Set<string>();
    for (const action of (scene.actions ?? [])) {
      // Unique action IDs within a scene
      if (seenIds.has(action.id)) {
        errors.push(`scene "${scene.id}": duplicate action id "${action.id}"`);
      }
      seenIds.add(action.id);

      // Binding exclusivity in the action's compute prog
      if (action.compute?.prog) {
        checkProgBindings(
          action.compute.prog,
          `scene "${scene.id}" action "${action.id}" compute`,
          errors,
        );
      }

      // Next-rule compute progs — proto repeated fields default to [] but plain
      // objects from tests may omit the field entirely.
      for (const rule of (action.next ?? [])) {
        const nc = rule.compute;
        if (!nc?.prog) continue;
        checkProgBindings(
          nc.prog,
          `scene "${scene.id}" action "${action.id}" next-rule`,
          errors,
        );
        // condition must name a declared binding in the prog
        const bindingNames = new Set(nc.prog.bindings.map((b) => b.name));
        if (nc.condition && !bindingNames.has(nc.condition)) {
          errors.push(
            `scene "${scene.id}" action "${action.id}" next-rule: ` +
            `condition "${nc.condition}" is not declared in prog bindings ` +
            `(declared: ${[...bindingNames].join(', ') || '(none)'})`,
          );
        }
      }
    }
  }

  return errors;
}

function checkProgBindings(prog: ProgModel, location: string, errors: string[]): void {
  for (const binding of (prog.bindings ?? [])) {
    checkBinding(binding, location, errors);
  }
}

function checkBinding(binding: BindingModel, location: string, errors: string[]): void {
  const hasValue = binding.value !== undefined;
  const hasExpr = binding.expr !== undefined;
  if (!hasValue && !hasExpr) {
    errors.push(`${location}: binding "${binding.name}" has neither value nor expr`);
  } else if (hasValue && hasExpr) {
    errors.push(`${location}: binding "${binding.name}" has both value and expr`);
  }
}
