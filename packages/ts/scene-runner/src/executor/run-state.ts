import type { StateManager } from "../state/state-manager.js";
import type { ActionTrace, SceneWarning, NextPolicy } from "../types/harness-types.js";
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

export function createRunState(initialState: StateManager, entryActions: string[]): SceneRunState {
  return {
    currentState: initialState,
    queue: [...entryActions],
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

export function enqueueNext(
  nextIds: string[],
  fromActionId: string,
  rs: SceneRunState,
  policy: NextPolicy,
): void {
  for (const nextId of nextIds) {
    if (rs.visited.has(nextId)) {
      const source = rs.enqueueSource.get(nextId) ?? "<entry>";
      if (policy === "all-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: true,
          message: `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
        });
      } else if (policy === "first-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: true,
          message: `action "${nextId}" was enqueued by "${source}" but already ran (first-match); next rule points to an already-executed action`,
        });
      }
      continue;
    }
    if (rs.enqueueSource.has(nextId)) {
      const source = rs.enqueueSource.get(nextId)!;
      if (policy === "all-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: false,
          message: `action "${nextId}" was enqueued more than once (all-match, first enqueued by "${source}") but ran only once`,
        });
      } else if (policy === "first-match") {
        rs.sceneWarnings.push({
          kind: "duplicate_enqueue",
          actionId: nextId,
          firstEnqueuedBy: source,
          policy,
          alreadyVisited: false,
          message: `action "${nextId}" was enqueued by "${fromActionId}" but is already pending (first enqueued by "${source}", first-match); second enqueue ignored`,
        });
      }
      continue;
    }
    rs.enqueueSource.set(nextId, fromActionId);
    rs.queue.push(nextId);
  }
}
