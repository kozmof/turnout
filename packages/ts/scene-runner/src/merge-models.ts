import type { MergeOrigin } from "./zig-runtime/client.js";
import { zigRuntimeModelJson } from "./model-encoding.js";
import type {
  FieldModel,
  NamespaceModel,
  RouteModel,
  SceneBlock,
  TurnModel,
  TypeDeclModel,
} from "./types/turnout-model_pb.js";
import { defaultZigRuntimeClient } from "./zig-runtime/default-client.js";

/**
 * Combine separately compiled models into one.
 *
 * Scenes are compiled apart and brought together at run time, so nothing has
 * checked that they agree until now. Merging is where that check happens: ids
 * must not collide, and any STATE path or named type declared by more than one
 * input must be declared identically.
 *
 * The result is an ordinary model. Prepare it, run it, or merge it again.
 *
 * The rules themselves live in the runtime, in `packages/zig/scene-runner/src/
 * merge.zig`. They have to: an action's `extend` hooks merge models mid-run,
 * where there is no host in the loop. This function calls the same
 * implementation rather than repeating it, so one set of rules produces one set
 * of messages whichever way a merge is reached.
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

  const response = defaultZigRuntimeClient.mergeModels(
    models.map(zigRuntimeModelJson),
    options.labels ?? [],
  );
  if (response.status !== "ok") {
    throw new ModelMergeError(conflictsOf(response.payload));
  }
  return assemble(models, first, response.payload.model, response.payload.provenance);
}

function conflictsOf(payload: unknown): readonly string[] {
  const conflicts = (payload as { conflicts?: unknown } | undefined)?.conflicts;
  if (!Array.isArray(conflicts)) return ["the runtime rejected the merge"];
  return conflicts.map(String);
}

/**
 * Rebuild the merged model from the inputs the caller passed in.
 *
 * The runtime works on the projection it reads, which has already dropped
 * annotations, source positions, and compute metadata a caller-facing model
 * keeps. Returning its JSON would quietly strip all of that. So the runtime
 * decides *what wins* — that is the part that must not be duplicated — and this
 * copies the winning objects straight out of the originals.
 */
function assemble(
  models: readonly TurnModel[],
  first: TurnModel,
  mergedJson: unknown,
  provenance: readonly MergeOrigin[],
): TurnModel {
  const root = mergedJson as Record<string, number>;
  const scenes: SceneBlock[] = [];
  const routes: RouteModel[] = [];
  const typeDecls: TypeDeclModel[] = [];
  /** Namespace name to its position in `namespaces`, so fields accumulate. */
  const namespaces: NamespaceModel[] = [];
  const namespaceSlots = new Map<string, number>();

  for (const origin of provenance) {
    const source = models[origin.input];
    if (source === undefined) continue;
    switch (origin.kind) {
      case "scene": {
        const scene = source.scenes?.find((candidate) => candidate.id === origin.id);
        if (scene !== undefined) scenes.push(scene);
        break;
      }
      case "route": {
        const route = source.routes?.find((candidate) => candidate.id === origin.id);
        if (route !== undefined) routes.push(route);
        break;
      }
      case "typeDecl": {
        const decl = source.typeDecls?.find((candidate) => candidate.name === origin.id);
        if (decl !== undefined) typeDecls.push(decl);
        break;
      }
      case "field": {
        const separator = origin.id.indexOf(".");
        const namespaceName = origin.id.slice(0, separator);
        const fieldName = origin.id.slice(separator + 1);
        const field = findField(source, namespaceName, fieldName);
        if (field === undefined) break;
        let slot = namespaceSlots.get(namespaceName);
        if (slot === undefined) {
          const declared = findNamespace(models, namespaceName);
          if (declared === undefined) break;
          slot = namespaces.length;
          namespaceSlots.set(namespaceName, slot);
          namespaces.push({ ...declared, fields: [] });
        }
        namespaces[slot]?.fields.push(field);
        break;
      }
    }
  }

  // A namespace that declares no fields contributes no provenance, so it is
  // picked up here rather than in the loop above. Dropping it would lose a
  // declared namespace that simply happens to be empty.
  for (const model of models) {
    for (const namespace of model.state?.namespaces ?? []) {
      if (namespaceSlots.has(namespace.name)) continue;
      namespaceSlots.set(namespace.name, namespaces.length);
      namespaces.push({ ...namespace, fields: [] });
    }
  }

  const merged = {
    ...first,
    version: root.version,
    minVersion: root.minVersion,
    maxVersion: root.maxVersion,
    scenes,
    routes,
    typeDecls,
  } as TurnModel;
  // A model with no STATE stays without one, rather than gaining an empty
  // schema that would switch execution from unchecked to schema-managed.
  if (namespaces.length > 0) merged.state = { ...first.state, namespaces } as never;
  return merged;
}

function findField(
  model: TurnModel,
  namespaceName: string,
  fieldName: string,
): FieldModel | undefined {
  const namespace = model.state?.namespaces?.find((candidate) => candidate.name === namespaceName);
  return namespace?.fields?.find((candidate) => candidate.name === fieldName);
}

/** The first declaration of a namespace, which is the one the merge keeps. */
function findNamespace(
  models: readonly TurnModel[],
  namespaceName: string,
): NamespaceModel | undefined {
  for (const model of models) {
    const namespace = model.state?.namespaces?.find(
      (candidate) => candidate.name === namespaceName,
    );
    if (namespace !== undefined) return namespace;
  }
  return undefined;
}
