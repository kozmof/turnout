import type { TurnModel, ProgModel, BindingModel } from "../types/turnout-model_pb.js";

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
  const sceneIds = new Set<string>();
  const routeIds = new Set<string>();

  for (const scene of model.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push(`duplicate scene id "${scene.id}"`);
    }
    sceneIds.add(scene.id);
  }

  for (const route of model.routes ?? []) {
    if (routeIds.has(route.id)) {
      errors.push(`duplicate route id "${route.id}"`);
    }
    routeIds.add(route.id);
    if (sceneIds.has(route.id)) {
      errors.push(`route id "${route.id}" conflicts with a scene id`);
    }
    if (!route.entrySceneId) {
      errors.push(`route "${route.id}" has no entry scene declared`);
    } else if (!sceneIds.has(route.entrySceneId)) {
      errors.push(`route "${route.id}" entry scene "${route.entrySceneId}" is not in the model`);
    }
    for (const arm of route.match ?? []) {
      if (!sceneIds.has(arm.target)) {
        errors.push(`route "${route.id}" match target "${arm.target}" is not in the model`);
      }
    }
  }

  for (const scene of model.scenes) {
    const actionIds = new Set<string>();
    for (const action of scene.actions ?? []) {
      if (actionIds.has(action.id)) {
        errors.push(`scene "${scene.id}": duplicate action id "${action.id}"`);
      }
      actionIds.add(action.id);
    }

    for (const entryAction of scene.entryActions ?? []) {
      if (!actionIds.has(entryAction)) {
        errors.push(`scene "${scene.id}": entry action "${entryAction}" is not declared`);
      }
    }

    for (const action of scene.actions ?? []) {
      const actionProgNames = action.compute?.prog
        ? checkProgBindings(
            action.compute.prog,
            `scene "${scene.id}" action "${action.id}" compute`,
            errors,
          )
        : new Set<string>();

      if (
        action.compute?.prog &&
        action.compute.root &&
        !actionProgNames.has(action.compute.root)
      ) {
        errors.push(
          `scene "${scene.id}" action "${action.id}" compute: root "${action.compute.root}" is not declared in prog bindings`,
        );
      }

      for (const merge of action.merge ?? []) {
        if (!action.compute?.prog) {
          errors.push(
            `scene "${scene.id}" action "${action.id}" merge: binding "${merge.binding}" cannot be read because the action has no compute prog`,
          );
        } else if (!actionProgNames.has(merge.binding)) {
          errors.push(
            `scene "${scene.id}" action "${action.id}" merge: binding "${merge.binding}" is not declared in compute prog bindings`,
          );
        }
      }

      for (const rule of action.next ?? []) {
        if (!actionIds.has(rule.action)) {
          errors.push(
            `scene "${scene.id}" action "${action.id}" next-rule: target action "${rule.action}" is not declared in the scene`,
          );
        }

        const nc = rule.compute;
        if (!nc?.prog) continue;
        const bindingNames = checkProgBindings(
          nc.prog,
          `scene "${scene.id}" action "${action.id}" next-rule`,
          errors,
        );
        if (nc.condition && !bindingNames.has(nc.condition)) {
          errors.push(
            `scene "${scene.id}" action "${action.id}" next-rule: ` +
              `condition "${nc.condition}" is not declared in prog bindings ` +
              `(declared: ${[...bindingNames].join(", ") || "(none)"})`,
          );
        }
      }
    }
  }

  return errors;
}

function checkProgBindings(prog: ProgModel, location: string, errors: string[]): Set<string> {
  const names = new Set<string>();
  for (const binding of prog.bindings ?? []) {
    if (names.has(binding.name)) {
      errors.push(`${location}: duplicate binding "${binding.name}"`);
    }
    names.add(binding.name);
    checkBinding(binding, location, errors);
  }
  return names;
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
