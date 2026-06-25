import type { TurnModel, RouteModel, SceneBlock } from "../types/turnout-model_pb.js";

export type DispatchTarget =
  | { kind: "route"; route: RouteModel; entryScene: SceneBlock }
  | { kind: "scene"; scene: SceneBlock };

type ModelIndex = {
  routeMap: Map<string, RouteModel>;
  sceneMap: Map<string, SceneBlock>;
};

function getModelIndex(model: TurnModel): ModelIndex {
  return {
    routeMap: new Map(model.routes?.map((r) => [r.id, r]) ?? []),
    sceneMap: new Map(model.scenes.map((s) => [s.id, s])),
  };
}

/**
 * Resolve `entryId` against a model's routes and scenes.
 *
 * - If `entryId` matches a route: validates that the route declares an `entrySceneId`
 *   and that the scene exists in the model. Throws on either violation.
 * - If `entryId` matches a scene: returns the scene directly.
 * - If neither: throws.
 *
 * The index is rebuilt for each call because generated protobuf models are
 * mutable and callers may legitimately reuse an object after editing it.
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
