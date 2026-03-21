import { executeGraph, assertValidContext, buildNull } from 'runtime';
import type { AnyValue, FuncId } from 'runtime';
import type { ActionModel } from '../types/turnout-model_pb.js';
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

  // Determine whether the root binding is a function or a plain value.
  const rootBinding = action.compute.prog.bindings.find((b) => b.name === action.compute!.root);
  const rootIsFunction = rootBinding?.expr !== undefined;

  let computeRootValue: AnyValue;
  let updatedTable = validatedCtx.valueTable;

  if (rootIsFunction) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const rootFuncId = builtCtx.ids[action.compute.root] as FuncId;
    const execResult = executeGraph(rootFuncId, validatedCtx);
    computeRootValue = execResult.value;
    updatedTable = execResult.updatedValueTable;
  } else {
    // Root is a plain value binding — read it directly from the value table.
    const rootValueId = builtCtx.nameToValueId[action.compute.root];
    computeRootValue = validatedCtx.valueTable[rootValueId] ?? buildNull('missing');
  }

  // Step 4: extract binding values for every binding in the prog.
  // Function bindings that are NOT reachable from the root (side-branch
  // computations consumed by next-rule from_action) must be executed separately.
  const bindingValues: Record<string, AnyValue> = {};
  for (const binding of action.compute.prog.bindings) {
    const valueId = builtCtx.nameToValueId[binding.name];
    let v = updatedTable[valueId];

    if (v === undefined && binding.expr) {
      // Not computed yet — run the sub-graph rooted at this function binding.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const subFuncId = builtCtx.ids[binding.name] as FuncId;
      const subResult = executeGraph(subFuncId, validatedCtx);
      updatedTable = { ...updatedTable, ...subResult.updatedValueTable };
      v = subResult.updatedValueTable[valueId];
    }

    if (v !== undefined) bindingValues[binding.name] = v;
  }

  // Step 5: apply merge entries — each write returns a new StateManager.
  let mergedState = state;
  for (const entry of action.merge ?? []) {
    const bindingVal = bindingValues[entry.binding];
    if (bindingVal !== undefined) {
      mergedState = mergedState.write(entry.toState, bindingVal);
    }
  }

  return {
    actionId: action.id,
    computeRootValue,
    bindingValues,
    stateAfterMerge: mergedState,
  };
}
