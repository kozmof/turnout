import type { ExecutionWarning, SceneTrace } from "../types/harness-types.js";

/**
 * Flattens the per-scene warnings carried on scene traces into one list, each
 * tagged with the scene that produced it.
 *
 * Traces arrive in completion order and a revisited scene contributes one trace
 * per visit, so the result preserves the order the warnings were raised in.
 *
 * Shared by every route driver so that `executeRoute`, `createRouteStepper`,
 * and the runners built on them report warnings identically.
 */
export function collectSceneWarnings(traces: readonly SceneTrace[]): ExecutionWarning[] {
  const collected: ExecutionWarning[] = [];
  for (const trace of traces) {
    for (const warning of trace.warnings ?? []) {
      collected.push({ kind: "scene_warning", sceneId: trace.sceneId, warning });
    }
  }
  return collected;
}
