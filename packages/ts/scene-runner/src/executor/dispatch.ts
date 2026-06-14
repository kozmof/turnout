import type { TurnModel, RouteModel, SceneBlock } from "../types/turnout-model_pb.js";

export type DispatchTarget =
  | { kind: "route"; route: RouteModel; entryScene: SceneBlock }
  | { kind: "scene"; scene: SceneBlock };

type ModelIndex = {
  routeMap: Map<string, RouteModel>;
  sceneMap: Map<string, SceneBlock>;
};

// Keyed on TurnModel object identity so the index is GC'd when the model is released.
const modelIndexCache = new WeakMap<TurnModel, ModelIndex>();

function getModelIndex(model: TurnModel): ModelIndex {
  let index = modelIndexCache.get(model);
  if (!index) {
    index = {
      routeMap: new Map(model.routes?.map((r) => [r.id, r]) ?? []),
      sceneMap: new Map(model.scenes.map((s) => [s.id, s])),
    };
    modelIndexCache.set(model, index);
  }
  return index;
}

/**
 * Resolve `entryId` against a model's routes and scenes in O(1).
 *
 * - If `entryId` matches a route: validates that the route declares an `entrySceneId`
 *   and that the scene exists in the model. Throws on either violation.
 * - If `entryId` matches a scene: returns the scene directly.
 * - If neither: throws.
 *
 * The route/scene index is built once per TurnModel instance and cached.
 */
export function resolveDispatchTarget(model: TurnModel, entryId: string): DispatchTarget {
  const { routeMap, sceneMap } = getModelIndex(model);

  const route = routeMap.get(entryId);
  if (route) {
    if (!route.entrySceneId) {
      throw new Error(`entry "${entryId}" is a route but has no entry scene declared`);
    }
    const entryScene = sceneMap.get(route.entrySceneId);
    if (!entryScene) {
      throw new Error(
        `entry "${entryId}" route entry scene "${route.entrySceneId}" is not in the model`,
      );
    }
    return { kind: "route", route, entryScene };
  }

  const scene = sceneMap.get(entryId);
  if (scene) {
    return { kind: "scene", scene };
  }

  throw new Error(`entryId "${entryId}" not found as route or scene in the model`);
}
