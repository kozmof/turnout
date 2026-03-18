import { executeGraph, assertValidContext, buildNull } from 'turnout';
import type { AnyValue, FuncId } from 'turnout';
import type { ActionModel } from '../types/scene-model.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry } from '../types/harness-types.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import { resolveActionPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';

/**
 * Execute a single action:
 *   1. Resolve prepare entries → injected values
 *   2. Build ExecutionContext from the action's prog
 *   3. Run executeGraph
 *   4. Extract binding values from the result
 *   5. Apply merge entries to STATE
 */
export function executeAction(
  action: ActionModel,
  state: StateManager,
  hooks: HookRegistry,
): ActionExecutionResult {
  // Actions without a compute block are no-ops (no graph, no merge).
  if (!action.compute) {
    return {
      actionId: action.id,
      computeRootValue: buildNull('missing'),
      bindingValues: {},
      stateAfterMerge: state,
    };
  }

  // Step 1: resolve prepare entries into injected binding values.
  const preparedValues = resolveActionPrepare(action.prepare ?? [], state, hooks);

  // Step 2: translate ProgModel + injected values → ExecutionContext.
  const builtCtx = buildContextFromProg(action.compute.prog, preparedValues);

  // Step 3: validate and execute.
  const validatedCtx = assertValidContext(builtCtx.exec);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const rootFuncId = builtCtx.ids[action.compute.root] as FuncId;
  const execResult = executeGraph(rootFuncId, validatedCtx);

  // Step 4: extract binding values for every binding in the prog.
  const bindingValues: Record<string, AnyValue> = {};
  for (const [name, valueId] of Object.entries(builtCtx.nameToValueId)) {
    const v = execResult.updatedValueTable[valueId];
    if (v !== undefined) bindingValues[name] = v;
  }

  // Step 5: apply merge entries — each write returns a new StateManager.
  let mergedState = state;
  for (const entry of action.merge ?? []) {
    const bindingVal = bindingValues[entry.binding];
    if (bindingVal !== undefined) {
      mergedState = mergedState.write(entry.to_state, bindingVal);
    }
  }

  return {
    actionId: action.id,
    computeRootValue: execResult.value,
    bindingValues,
    stateAfterMerge: mergedState,
  };
}
