import type {
  TurnModel,
  ProgModel,
  BindingModel,
  PrepareEntry,
  NextPrepareEntry,
} from "./types/turnout-model_pb.js";

const TERMINAL_ROUTE_TARGET = ".";

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
 *
 * The engine runs the same checks in `packages/zig/scene-runner/src/
 * structure.zig`, and `spec/structural-rules.json` records which rules the two
 * share, which two this host deliberately adds, and the wording they must
 * agree on. `scripts/check-structural-rules.mjs` fails when either side drifts
 * from that record. Running here as well is a host convenience — a synchronous
 * `ModelValidationError` before any engine call — not a second opinion: a rule
 * this host enforces that the engine does not has to be listed as host-only,
 * with a reason.
 */
export function validateModel(model: TurnModel): string[] {
  const errors: string[] = [];
  const index = indexModel(model);

  // Order matches the sequence the checks used to run in, so a caller reading
  // errors[0] sees what it always did.
  for (const sceneId of index.duplicateSceneIds) {
    errors.push(`duplicate scene id "${sceneId}"`);
  }
  checkRoutes(model, index, errors);
  checkScenes(model, index, errors);

  return errors;
}

/** Scene ids, per-scene action ids, and whether the model can grow mid-run. */
interface ModelStructureIndex {
  sceneIds: Set<string>;
  /** Scene ids declared more than once, in first-duplicate order. */
  duplicateSceneIds: Set<string>;
  /** Action ids per scene id, in model order. */
  actionIdsByScene: Map<string, Set<string>>;
  growable: boolean;
}

/**
 * Collect scene ids, action ids and growability in one pass, reporting the
 * duplicates found on the way.
 *
 * Built once and shared by every later check. The scene list was previously
 * walked three times — once for ids, once for routes, once for the per-scene
 * detail — rebuilding each scene's action-id set on the last of them. That is
 * on `createRunner`'s unprepared path, which the README already calls out as
 * the expensive one.
 */
function indexModel(model: TurnModel): ModelStructureIndex {
  const sceneIds = new Set<string>();
  const duplicateSceneIds = new Set<string>();
  const actionIdsByScene = new Map<string, Set<string>>();
  let growable = false;

  for (const scene of model.scenes) {
    if (sceneIds.has(scene.id)) duplicateSceneIds.add(scene.id);
    sceneIds.add(scene.id);

    // Two scene blocks sharing an id are reported once, and their actions are
    // pooled rather than the later block's set replacing the earlier one's —
    // so an `entryAction` or `next` target declared in either still resolves,
    // and the duplicate id is the single error raised.
    const actionIds = actionIdsByScene.get(scene.id) ?? new Set<string>();
    for (const action of scene.actions ?? []) {
      actionIds.add(action.id);
      if ((action.extend ?? []).length > 0) growable = true;
    }
    actionIdsByScene.set(scene.id, actionIds);
  }

  return { sceneIds, duplicateSceneIds, actionIdsByScene, growable };
}

function checkRoutes(model: TurnModel, index: ModelStructureIndex, errors: string[]): void {
  const routeIds = new Set<string>();

  for (const route of model.routes ?? []) {
    if (routeIds.has(route.id)) {
      errors.push(`duplicate route id "${route.id}"`);
    }
    routeIds.add(route.id);
    if (index.sceneIds.has(route.id)) {
      errors.push(`route id "${route.id}" conflicts with a scene id`);
    }
    if (!route.entrySceneId) {
      errors.push(`route "${route.id}" has no entry scene declared`);
    } else if (!index.sceneIds.has(route.entrySceneId)) {
      errors.push(`route "${route.id}" entry scene "${route.entrySceneId}" is not in the model`);
    }
    // A route arm may name a scene an extend hook has yet to bring in. That is
    // the point of merging mid-run, so a model that can grow is not held to
    // having every target already. Reaching a target that never arrives is
    // still an error, raised by the runtime when the transition is taken.
    if (index.growable) continue;
    for (const arm of route.match ?? []) {
      if (arm.target !== TERMINAL_ROUTE_TARGET && !index.sceneIds.has(arm.target)) {
        errors.push(`route "${route.id}" match target "${arm.target}" is not in the model`);
      }
    }
  }
}

function checkScenes(model: TurnModel, index: ModelStructureIndex, errors: string[]): void {
  for (const scene of model.scenes) {
    const actionIds = index.actionIdsByScene.get(scene.id) ?? new Set<string>();
    const seenActionIds = new Set<string>();
    for (const action of scene.actions ?? []) {
      if (seenActionIds.has(action.id)) {
        errors.push(`scene "${scene.id}": duplicate action id "${action.id}"`);
      }
      seenActionIds.add(action.id);
    }

    if (scene.entryAction && !actionIds.has(scene.entryAction)) {
      errors.push(`scene "${scene.id}": entry action "${scene.entryAction}" is not declared`);
    }

    for (const action of scene.actions ?? []) {
      const actionProgNames = action.compute?.prog
        ? checkProgBindings(
            action.compute.prog,
            `scene "${scene.id}" action "${action.id}" compute`,
            errors,
            filledBindings(action.prepare),
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

      // Host-only rule. The engine warns and carries on for a merge naming a
      // binding no prog declares; this host rejects it as a likely typo.
      // See spec/structural-rules.json → hostOnly.
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
        // Host-only rule. The engine warns and carries on for a next rule
        // naming an action the scene does not have; this host rejects it.
        // See spec/structural-rules.json → hostOnly.
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
          filledBindings(rule.prepare),
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
}

/**
 * The binding names a prepare schedule fills before the prog runs.
 *
 * A binding listed here legitimately carries neither `value` nor `expr`: the
 * value arrives from STATE, from a hook, or from an earlier action. The
 * compiler emits a placeholder `value` for those, so this only matters for a
 * model assembled by hand or by a merge — but the engine consults the same
 * schedule (`structure.zig`, `checkProgBindings`), and a host that rejected
 * what the engine runs would be the stricter of the two by accident rather
 * than by decision.
 */
function filledBindings(
  prepare: readonly (PrepareEntry | NextPrepareEntry)[] | undefined,
): Set<string> {
  const filled = new Set<string>();
  for (const entry of prepare ?? []) filled.add(entry.binding);
  return filled;
}

function checkProgBindings(
  prog: ProgModel,
  location: string,
  errors: string[],
  filled: Set<string>,
): Set<string> {
  const names = new Set<string>();
  for (const binding of prog.bindings ?? []) {
    if (names.has(binding.name)) {
      errors.push(`${location}: duplicate binding "${binding.name}"`);
    }
    names.add(binding.name);
    checkBinding(binding, location, errors, filled);
  }
  return names;
}

function checkBinding(
  binding: BindingModel,
  location: string,
  errors: string[],
  filled: Set<string>,
): void {
  const hasValue = binding.value !== undefined;
  const hasExpr = binding.expr !== undefined;
  if (hasValue && hasExpr) {
    errors.push(`${location}: binding "${binding.name}" has both value and expr`);
  } else if (!hasValue && !hasExpr && !filled.has(binding.name)) {
    errors.push(
      `${location}: binding "${binding.name}" has neither value nor expr, and no prepare entry fills it`,
    );
  }
}
