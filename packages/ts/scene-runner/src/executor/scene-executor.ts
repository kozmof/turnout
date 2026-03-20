import { executeGraph, assertValidContext, isPureBoolean } from 'runtime';
import type { FuncId } from 'runtime';
import type { SceneBlock, ActionModel, NextPolicy } from '../types/scene-model.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, ActionTrace, SceneTrace } from '../types/harness-types.js';
import { executeAction } from './action-executor.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import { resolveNextPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type SceneExecutionResult = {
  sceneId: string;
  stateAfterScene: StateManager;
  trace: SceneTrace;
  /** Action IDs that reached a terminal state (no matching next rule). */
  terminatedAt: string[];
};

export type StepResult =
  | { done: false; trace: ActionTrace }
  | { done: true; trace?: undefined };

// ─────────────────────────────────────────────────────────────────────────────
// Scene executor — manual stepping API
// ─────────────────────────────────────────────────────────────────────────────

export type SceneExecutor = {
  readonly isDone: () => boolean;
  /** Execute the next pending action. Returns `{ done: true }` when the queue is empty. */
  readonly next: () => StepResult;
  /** Returns the final result. Throws if the scene is not yet complete. */
  readonly result: () => SceneExecutionResult;
};

/**
 * Creates a scene executor that advances one action at a time via `next()`.
 *
 * @example
 * const executor = createSceneExecutor(scene, state, hooks);
 * while (!executor.isDone()) {
 *   const { trace } = executor.next();
 * }
 * const result = executor.result();
 */
export function createSceneExecutor(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = {},
): SceneExecutor {
  const actionMap = buildActionMap(scene.actions);
  const policy: NextPolicy = scene.next_policy ?? 'first-match';

  let currentState = state;
  const queue: string[] = [...scene.entry_actions];
  const visited = new Set<string>();
  const actionTraces: ActionTrace[] = [];
  const terminatedAt: string[] = [];

  function drainVisited(): void {
    while (queue.length > 0 && visited.has(queue[0]!)) queue.shift();
  }

  function isDone(): boolean {
    drainVisited();
    return queue.length === 0;
  }

  function next(): StepResult {
    drainVisited();
    if (queue.length === 0) return { done: true };

    const actionId = queue.shift()!;
    visited.add(actionId);

    const action = actionMap[actionId];
    if (!action) throw new Error(`Scene "${scene.id}": unknown action "${actionId}"`);

    const result = executeAction(action, currentState, hooks);
    currentState = result.stateAfterMerge;

    const nextIds = evaluateNextRules(action, currentState, result, policy);
    if (nextIds.length === 0) terminatedAt.push(actionId);

    const trace: ActionTrace = {
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
    };
    actionTraces.push(trace);
    queue.push(...nextIds);

    return { done: false, trace };
  }

  function result(): SceneExecutionResult {
    if (!isDone()) throw new Error(`Scene "${scene.id}": execution is not complete`);
    return {
      sceneId: scene.id,
      stateAfterScene: currentState,
      trace: { sceneId: scene.id, actions: actionTraces },
      terminatedAt,
    };
  }

  return { isDone, next, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience wrapper — runs the scene to completion in one call
// ─────────────────────────────────────────────────────────────────────────────

export function executeScene(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = {},
): SceneExecutionResult {
  const executor = createSceneExecutor(scene, state, hooks);
  while (!executor.isDone()) executor.next();
  return executor.result();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildActionMap(actions: ActionModel[]): Record<string, ActionModel> {
  const map: Record<string, ActionModel> = {};
  for (const a of actions) map[a.id] = a;
  return map;
}

/**
 * Evaluate the next rules for a completed action and return the IDs of the
 * actions to enqueue, according to the scene's `next_policy`.
 */
function evaluateNextRules(
  action: ActionModel,
  state: StateManager,
  result: ActionExecutionResult,
  policy: NextPolicy,
): string[] {
  const rules = action.next ?? [];
  const matches: string[] = [];

  for (const rule of rules) {
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else {
      const nextPrepared = resolveNextPrepare(rule.prepare ?? [], state, result);
      const builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared);
      const validated = assertValidContext(builtCtx.exec);

      const conditionName = rule.compute.condition;
      const condBinding = rule.compute.prog.bindings.find((b) => b.name === conditionName);

      let condValue;
      if (condBinding?.expr) {
        // Function binding: run the graph and read the root's return value.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        const condFuncId = builtCtx.ids[conditionName] as FuncId;
        condValue = executeGraph(condFuncId, validated).value;
      } else {
        // Value binding: the value is already in the context's value table.
        const condValueId = builtCtx.nameToValueId[conditionName];
        condValue = validated.valueTable[condValueId];
      }

      condMet = isPureBoolean(condValue) && condValue.value;
    }

    if (condMet) {
      matches.push(rule.action);
      if (policy === 'first-match') break;
    }
  }

  return matches;
}
