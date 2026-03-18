import { executeGraph, assertValidContext, isPureBoolean } from 'turnout';
import type { FuncId } from 'turnout';
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

// ─────────────────────────────────────────────────────────────────────────────
// Scene executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a scene by draining the action queue until no further next rules fire.
 *
 * @param scene   - The scene definition (entry actions, policy, action list).
 * @param state   - The current STATE at scene entry (may carry values from prior scenes).
 * @param hooks   - Optional hook registry for from_hook prepare resolution.
 */
export function executeScene(
  scene: SceneBlock,
  state: StateManager,
  hooks: HookRegistry = {},
): SceneExecutionResult {
  const actionMap = buildActionMap(scene.actions);
  const policy: NextPolicy = scene.next_policy ?? 'first-match';

  const queue: string[] = [...scene.entry_actions];
  const visited = new Set<string>();
  const actionTraces: ActionTrace[] = [];
  const terminatedAt: string[] = [];

  while (queue.length > 0) {
    const actionId = queue.shift()!;

    // Cycle guard: each action runs at most once per scene execution.
    if (visited.has(actionId)) continue;
    visited.add(actionId);

    const action = actionMap[actionId];
    if (!action) throw new Error(`Scene "${scene.id}": unknown action "${actionId}"`);

    const result = executeAction(action, state, hooks);
    state = result.stateAfterMerge;

    const nextIds = evaluateNextRules(action, state, result, policy);
    if (nextIds.length === 0) terminatedAt.push(actionId);

    actionTraces.push({
      actionId,
      computeRootValue: result.computeRootValue,
      nextActionIds: nextIds,
    });

    queue.push(...nextIds);
  }

  return {
    sceneId: scene.id,
    stateAfterScene: state,
    trace: { sceneId: scene.id, actions: actionTraces },
    terminatedAt,
  };
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
