// Post-run helpers for inspecting an ExecutionTrace.
import type { ExecutionTrace, SceneTrace } from "./types/harness-types.js";

/** A single failed publish hook, located by scene + action. */
export type PublishFailure = {
  sceneId: string;
  actionId: string;
  hookName: string;
  message: string;
};

function collectFromScene(scene: SceneTrace, out: PublishFailure[]): void {
  for (const action of scene.actions) {
    for (const outcome of action.publishOutcomes ?? []) {
      if (outcome.status === "error") {
        out.push({
          sceneId: scene.sceneId,
          actionId: action.actionId,
          hookName: outcome.hookName,
          message: outcome.message,
        });
      }
    }
  }
}

/**
 * Walk a completed `ExecutionTrace` (or any result object carrying one) and
 * return every publish hook that failed. Use this when running with the default
 * `failOnPublishError: false` to surface partial side-effect failures without
 * aborting execution.
 *
 * Returns an empty array when all publishes succeeded (or none ran).
 *
 * @example
 * const result = await runHarness({ model, entryId, initialState, hooks });
 * const failures = collectPublishFailures(result.trace);
 * if (failures.length > 0) alertOps(failures);
 */
export function collectPublishFailures(
  trace: ExecutionTrace | { trace: ExecutionTrace },
): PublishFailure[] {
  const t: ExecutionTrace = "kind" in trace ? trace : trace.trace;
  const out: PublishFailure[] = [];
  if (t.kind === "scene") {
    collectFromScene(t.scene, out);
  } else {
    for (const scene of t.route.scenes) collectFromScene(scene, out);
  }
  return out;
}
