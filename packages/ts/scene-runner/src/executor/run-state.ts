import type { StateManager } from "../state/state-manager.js";
import type { ActionTrace, SceneWarning } from "../types/harness-types.js";
import { RuleCtxCache } from "./next-rules.js";

export type SceneRunState = {
  currentState: StateManager;
  queue: string[];
  queueHead: number;
  readonly visited: Set<string>;
  readonly enqueueSource: Map<string, string>;
  readonly actionTraces: ActionTrace[];
  readonly terminatedAt: string[];
  readonly sceneWarnings: SceneWarning[];
  stepCount: number;
  currentAction: string | undefined;
  readonly ruleCtxCache: RuleCtxCache;
};

export function createRunState(initialState: StateManager, entryAction: string): SceneRunState {
  return {
    currentState: initialState,
    queue: [entryAction],
    queueHead: 0,
    visited: new Set(),
    enqueueSource: new Map(),
    actionTraces: [],
    terminatedAt: [],
    sceneWarnings: [],
    stepCount: 0,
    currentAction: undefined,
    ruleCtxCache: new RuleCtxCache(),
  };
}

/**
 * Queue the actions selected by the current action's next rules.
 *
 * Selection stops at the first true rule, so `nextIds` holds at most one id and
 * an action already recorded in `enqueueSource` has necessarily run — the step
 * loop marks an action visited as it dequeues it, before this is ever called
 * again. A repeat enqueue is therefore always a rule pointing back at a
 * completed action, which is a graph the author probably did not intend, so it
 * is reported rather than silently ignored.
 */
export function enqueueNext(nextIds: string[], fromActionId: string, rs: SceneRunState): void {
  for (const nextId of nextIds) {
    const source = rs.enqueueSource.get(nextId);
    if (source !== undefined || rs.visited.has(nextId)) {
      rs.sceneWarnings.push({
        kind: "duplicate_enqueue",
        actionId: nextId,
        firstEnqueuedBy: source ?? "<entry>",
        message: `action "${nextId}" was enqueued by "${fromActionId}" but already ran (first enqueued by "${source ?? "<entry>"}"); next rule points to an already-executed action`,
      });
      continue;
    }
    rs.enqueueSource.set(nextId, fromActionId);
    rs.queue.push(nextId);
  }
}
