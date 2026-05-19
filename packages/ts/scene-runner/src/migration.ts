import type { TurnModel } from './types/turnout-model_pb.js';

type MigrationFn = (model: TurnModel) => TurnModel;

// Maps from-version to the migration that produces from-version+1.
// Migrations run in order until the model reaches the current supported version.
const migrations: Record<number, MigrationFn> = {
  // 0 → 1: version 0 predates the version field; semantically identical to v1.
  0: (model) => model,
};

const CURRENT_VERSION = 1;

/**
 * Apply sequential migrations to bring `model` up to `CURRENT_VERSION`.
 * Returns the migrated model (may be the same reference if no migration ran).
 * Throws if the model's version is already above the current supported version.
 */
export function migrateModel(model: TurnModel): TurnModel {
  const versionedModel = model as TurnModel & { version?: number };
  let version = versionedModel.version ?? 0;

  if (version > CURRENT_VERSION) {
    throw new Error(
      `Model schema version ${version} is not supported; expected ${CURRENT_VERSION}. ` +
      `Regenerate the model with a compatible converter.`,
    );
  }

  let current: TurnModel = model;
  while (version < CURRENT_VERSION) {
    const migrate = migrations[version];
    if (!migrate) break;
    current = migrate(current);
    version++;
  }
  return current;
}
