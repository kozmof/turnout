import type { TurnModel, RouteModel, SceneBlock } from '../types/turnout-model_pb.js';

export type DispatchTarget =
  | { kind: 'route'; route: RouteModel; entryScene: SceneBlock }
  | { kind: 'scene'; scene: SceneBlock };

/**
 * Resolve `entryId` against a model's routes and scenes.
 *
 * - If `entryId` matches a route: validates that the route declares an `entrySceneId`
 *   and that the scene exists in the model. Throws on either violation.
 * - If `entryId` matches a scene: returns the scene directly.
 * - If neither: throws.
 */
export function resolveDispatchTarget(
  model: TurnModel,
  entryId: string,
  sceneMap?: Record<string, SceneBlock>,
): DispatchTarget {
  const map = sceneMap ?? Object.fromEntries(model.scenes.map((s) => [s.id, s]));

  const route = (model.routes ?? []).find((r) => r.id === entryId);
  if (route) {
    if (!route.entrySceneId) {
      throw new Error(`entry "${entryId}" is a route but has no entry scene declared`);
    }
    const entryScene = map[route.entrySceneId];
    if (!entryScene) {
      throw new Error(
        `entry "${entryId}" route entry scene "${route.entrySceneId}" is not in the model`,
      );
    }
    return { kind: 'route', route, entryScene };
  }

  const scene = map[entryId];
  if (scene) {
    return { kind: 'scene', scene };
  }

  throw new Error(`entryId "${entryId}" not found as route or scene in the model`);
}
