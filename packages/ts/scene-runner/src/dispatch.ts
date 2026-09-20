import type { TurnModel, RouteModel, SceneBlock } from "./types/turnout-model_pb.js";
import { ModelValidationError, RunnerError } from "./errors.js";

export type DispatchTarget =
  | { kind: "route"; route: RouteModel; entryScene: SceneBlock }
  | { kind: "scene"; scene: SceneBlock };

export type ModelIndex = {
  routeMap: Map<string, RouteModel>;
  sceneMap: Map<string, SceneBlock>;
};

/**
 * Index a model's routes and scenes by id.
 *
 * Exported so a caller holding an immutable model can build this once instead
 * of once per run — see `PreparedModel`, whose whole purpose is to hoist work
 * that does not depend on the run.
 */
export function buildModelIndex(model: TurnModel): ModelIndex {
  return {
    routeMap: new Map(model.routes?.map((r) => [r.id, r]) ?? []),
    sceneMap: new Map(model.scenes.map((s) => [s.id, s])),
  };
}

/**
 * Resolve `entryId` against a model's routes and scenes.
 *
 * - If `entryId` matches a route: validates that the route declares an `entrySceneId`
 *   and that the scene exists in the model. Throws `ModelValidationError` on
 *   either violation — both are defects in the model, and `validateModel`
 *   reports the same two with the same wording, so arriving here through
 *   `createRunner` or through this function directly raises the same error.
 * - If `entryId` matches a scene: returns the scene directly.
 * - If neither: throws `RunnerError("EntryNotFound")`. That one is not a defect
 *   in the model but in the `entryId` the caller chose, so it belongs to the
 *   runner's error family rather than the model's.
 *
 * The index is rebuilt for each call because generated protobuf models are
 * mutable and callers may legitimately reuse an object after editing it. Pass
 * `index` to skip that when the model is known not to change — a prepared
 * model, whose contents are fixed once the runtime has a handle on them.
 */
export function resolveDispatchTarget(
  model: TurnModel,
  entryId: string,
  index?: ModelIndex,
): DispatchTarget {
  const { routeMap, sceneMap } = index ?? buildModelIndex(model);

  const route = routeMap.get(entryId);
  if (route) {
    if (!route.entrySceneId) {
      throw new ModelValidationError([`route "${entryId}" has no entry scene declared`]);
    }
    const entryScene = sceneMap.get(route.entrySceneId);
    if (!entryScene) {
      throw new ModelValidationError([
        `route "${entryId}" entry scene "${route.entrySceneId}" is not in the model`,
      ]);
    }
    return { kind: "route", route, entryScene };
  }

  const scene = sceneMap.get(entryId);
  if (scene) {
    return { kind: "scene", scene };
  }

  throw new RunnerError(
    "EntryNotFound",
    `entryId "${entryId}" not found as route or scene in the model`,
  );
}
