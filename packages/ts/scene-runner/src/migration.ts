import type { TurnModel, SceneBlock, ProgModel } from "./types/turnout-model_pb.js";

type MigrationFn = (model: TurnModel) => TurnModel;

const CURRENT_VERSION = 2;

/**
 * Every model version this package knows about, oldest first.
 *
 * Adding a version means adding it here and bumping CURRENT_VERSION — at which
 * point `migrations` is missing a key and will not compile until the step that
 * produces the new version is written. That is the point of spelling the
 * versions out: the table used to be a `Record<number, MigrationFn>`, where a
 * missing step was a string thrown at load time, on a model, in someone else's
 * process.
 */
type ModelVersion = 0 | 1 | 2;

/** The versions a model can still be migrated *from*. */
type PriorVersion = Exclude<ModelVersion, typeof CURRENT_VERSION>;

// Maps from-version to the migration that produces from-version+1.
// Migrations run in order until the model reaches the current supported version.
const migrations: Record<PriorVersion, MigrationFn> = {
  // 0 → 1: version 0 predates the version field; semantically identical to v1.
  0: (model) => model,
  // 1 → 2: v2 adds literal & template type declarations and the template_extract
  // runtime functions used by template case destructuring. A v1 model uses none
  // of these, so the migration is the identity.
  1: (model) => model,
};

/**
 * Whether `version` is one this package can migrate from.
 *
 * `migrateModel` has already rejected anything above CURRENT_VERSION, so this
 * is really asking about the bottom of the range: a model declaring a negative
 * version reaches the loop otherwise, finds no handler, and reports a missing
 * migration step — blaming this package for what the model got wrong.
 */
function isPriorVersion(version: number): version is PriorVersion {
  return Number.isInteger(version) && version >= 0 && version < CURRENT_VERSION;
}

/**
 * Apply sequential migrations to bring `model` up to `CURRENT_VERSION`.
 * Returns the migrated model (may be the same reference if no migration ran).
 * Throws if the model's version is above the current supported version, or if
 * CURRENT_VERSION falls outside the model's declared [minVersion, maxVersion].
 */
export function migrateModel(model: TurnModel): TurnModel {
  const versionedModel = model as TurnModel & { version?: number };
  let version = versionedModel.version ?? 0;

  // Respect min_version / max_version when the emitter declares them (non-zero).
  const minVersion = model.minVersion ?? 0;
  const maxVersion = model.maxVersion ?? 0;
  if (minVersion > 0 && CURRENT_VERSION < minVersion) {
    throw new Error(
      `Runtime version ${CURRENT_VERSION} is below the model's required minimum version ${minVersion}. ` +
        `Upgrade the scene-runner package.`,
    );
  }
  if (maxVersion > 0 && CURRENT_VERSION > maxVersion) {
    throw new Error(
      `Runtime version ${CURRENT_VERSION} exceeds the model's maximum compatible version ${maxVersion}. ` +
        `Regenerate the model with a compatible converter.`,
    );
  }

  if (version > CURRENT_VERSION) {
    throw new Error(
      `Model schema version ${version} is not supported; expected ${CURRENT_VERSION}. ` +
        `Regenerate the model with a compatible converter.`,
    );
  }

  let current: TurnModel = model;
  while (version < CURRENT_VERSION) {
    if (!isPriorVersion(version)) {
      throw new Error(
        `Model schema version ${version} is not a version this runtime can migrate from; ` +
          `expected a whole number between 0 and ${CURRENT_VERSION}. ` +
          `Regenerate the model with a compatible converter.`,
      );
    }
    current = migrations[version](current);
    version++;
  }

  checkForExtExpr(current);
  return current;
}

// checkForExtExpr scans all action compute and next-rule progs for extExpr
// bindings. extExpr is a pre-lowering representation that must never appear in
// emitted JSON; if found, the model was produced by an old converter that did
// not expand if/case/pipe expressions at emit time. Detecting this here
// (at load time) produces a clear, actionable error before execution starts.
function checkForExtExpr(model: TurnModel): void {
  for (const scene of model.scenes ?? []) {
    checkSceneForExtExpr(scene);
  }
}

/**
 * Scan a single SceneBlock for `extExpr` bindings in action compute and
 * next-rule compute progs. Throws if any are found.
 *
 * Called by `createSceneRunner` and `createRouteRunner` so that direct users
 * of those lower-level APIs get the same early, actionable error that
 * `createRunner` (via `migrateModel`) provides.
 */
export function checkSceneForExtExpr(scene: SceneBlock): void {
  // An absent repeated field is an empty list, per the runtime contract, so a
  // scene that declares no actions is merely empty rather than malformed.
  for (const action of scene.actions ?? []) {
    checkProgForExtExpr(action.compute?.prog, action.id, "action compute");
    for (const rule of action.next ?? []) {
      checkProgForExtExpr(rule.compute?.prog, action.id, "next-rule compute");
    }
  }
}

function checkProgForExtExpr(
  prog: ProgModel | undefined,
  actionId: string,
  location: string,
): void {
  if (!prog) return;
  for (const binding of prog.bindings) {
    if (binding.extExpr !== undefined) {
      throw new Error(
        `Action "${actionId}" ${location} binding "${binding.name}" contains an extExpr field, ` +
          `which is a pre-lowering representation that must not appear in emitted JSON. ` +
          `Re-compile the source with the current converter to fix this.`,
      );
    }
  }
}
