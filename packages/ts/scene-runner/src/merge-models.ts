import type {
  FieldModel,
  NamespaceModel,
  RouteModel,
  SceneBlock,
  TurnModel,
  TypeDeclModel,
} from "./types/turnout-model_pb.js";

/**
 * Combine separately compiled models into one.
 *
 * Scenes are compiled apart and brought together at run time, so nothing has
 * checked that they agree until now. Merging is where that check happens: ids
 * must not collide, and any STATE path or named type declared by more than one
 * input must be declared identically.
 *
 * The result is an ordinary model. Prepare it, run it, or merge it again.
 */

/** A conflict between two inputs, naming both so the source is obvious. */
export class ModelMergeError extends Error {
  readonly conflicts: readonly string[];

  constructor(conflicts: readonly string[]) {
    super(`cannot merge models:\n  ${conflicts.join("\n  ")}`);
    this.name = "ModelMergeError";
    this.conflicts = conflicts;
  }
}

export interface MergeOptions {
  /**
   * Names for the inputs, used in conflict messages. Positional; inputs without
   * a label are called "model 0", "model 1", and so on.
   */
  labels?: readonly string[];
}

/**
 * Merge models left to right.
 *
 * Every collision is an error rather than an override. Two models that both
 * define a scene do not have a defensible winner, and silently picking one
 * would turn a packaging mistake into a behavioural one. Rename the scene, or
 * drop it from one input.
 *
 * All conflicts are collected before throwing, so one merge reports everything
 * wrong rather than the first thing wrong.
 */
export function mergeModels(models: readonly TurnModel[], options: MergeOptions = {}): TurnModel {
  if (models.length === 0) throw new ModelMergeError(["no models to merge"]);
  const first = models[0];
  if (first === undefined) throw new ModelMergeError(["no models to merge"]);
  if (models.length === 1) return first;

  const label = (index: number): string => options.labels?.[index] ?? `model ${index}`;
  const conflicts: string[] = [];

  const scenes: SceneBlock[] = [];
  const routes: RouteModel[] = [];
  const typeDecls: TypeDeclModel[] = [];
  /** Declared path to the input that declared it, and how. */
  const sceneOwners = new Map<string, number>();
  const routeOwners = new Map<string, number>();
  const typeOwners = new Map<string, { index: number; encoded: string }>();
  const fieldOwners = new Map<string, { index: number; encoded: string }>();
  /** Namespace name to its position in `namespaces`, so fields accumulate. */
  const namespaces: NamespaceModel[] = [];
  const namespaceSlots = new Map<string, number>();

  let version = first.version;
  let minVersion = first.minVersion;
  let maxVersion = first.maxVersion;

  models.forEach((model, index) => {
    if (model.version !== version) {
      conflicts.push(
        `${label(index)} is version ${model.version}, ${label(0)} is version ${version}`,
      );
      version = Math.max(version, model.version);
    }
    // The merged model must satisfy every input, so the window is the tightest
    // of them: the highest floor and the lowest declared ceiling.
    minVersion = Math.max(minVersion, model.minVersion);
    if (model.maxVersion !== 0) {
      maxVersion = maxVersion === 0 ? model.maxVersion : Math.min(maxVersion, model.maxVersion);
    }

    for (const scene of model.scenes ?? []) {
      const owner = sceneOwners.get(scene.id);
      if (owner !== undefined) {
        conflicts.push(`scene "${scene.id}" is declared by ${label(owner)} and ${label(index)}`);
        continue;
      }
      sceneOwners.set(scene.id, index);
      scenes.push(scene);
    }

    for (const route of model.routes ?? []) {
      const owner = routeOwners.get(route.id);
      if (owner !== undefined) {
        conflicts.push(`route "${route.id}" is declared by ${label(owner)} and ${label(index)}`);
        continue;
      }
      routeOwners.set(route.id, index);
      routes.push(route);
    }

    for (const namespace of model.state?.namespaces ?? []) {
      let slot = namespaceSlots.get(namespace.name);
      if (slot === undefined) {
        slot = namespaces.length;
        namespaceSlots.set(namespace.name, slot);
        namespaces.push({ ...namespace, fields: [] });
      }
      const merged = namespaces[slot];
      if (merged === undefined) continue;
      for (const field of namespace.fields ?? []) {
        const path = `${namespace.name}.${field.name}`;
        const encoded = encodeField(field);
        const owner = fieldOwners.get(path);
        if (owner === undefined) {
          fieldOwners.set(path, { index, encoded });
          merged.fields.push(field);
          continue;
        }
        // Declaring the same field the same way twice is agreement, not a
        // conflict: two scene sets that both need a field will both declare it.
        if (owner.encoded === encoded) continue;
        conflicts.push(
          `STATE field "${path}" is declared as ${encoded} by ${label(index)} and as ` +
            `${owner.encoded} by ${label(owner.index)}`,
        );
      }
    }

    for (const decl of model.typeDecls ?? []) {
      const encoded = JSON.stringify(decl);
      const owner = typeOwners.get(decl.name);
      if (owner === undefined) {
        typeOwners.set(decl.name, { index, encoded });
        typeDecls.push(decl);
        continue;
      }
      if (owner.encoded === encoded) continue;
      conflicts.push(
        `type "${decl.name}" is declared differently by ${label(owner.index)} and ${label(index)}`,
      );
    }
  });

  if (conflicts.length > 0) throw new ModelMergeError(conflicts);

  const merged = {
    ...first,
    version,
    minVersion,
    maxVersion,
    scenes,
    routes,
    typeDecls,
  } as TurnModel;
  // A model with no STATE stays without one, rather than gaining an empty
  // schema that would switch execution from unchecked to schema-managed.
  if (namespaces.length > 0) merged.state = { ...first.state, namespaces } as never;
  return merged;
}

/** How a field is declared, as a comparable string. */
function encodeField(field: FieldModel): string {
  return `${field.type}=${JSON.stringify(field.value ?? null)}`;
}
