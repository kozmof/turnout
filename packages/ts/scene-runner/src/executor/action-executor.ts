import { assertValidContext, buildNull, buildExecutionTree, buildReturnIdToFuncIdMap, executeTree } from 'runtime';
import type { AnyValue, FuncId, ExecutionTree } from 'runtime';
import type { ActionModel } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, PublishHookContext } from '../types/harness-types.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import { resolveActionPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';
import type { PublishHookOutcome } from '../types/harness-types.js';
import { SceneRuntimeError } from './errors.js';

/**
 * Execute a single action:
 *   1. Resolve prepare entries → injected values
 *   2. Build ExecutionContext from the action's prog
 *   3. Build and execute compute graphs
 *   4. Extract binding values from the result
 *   5. Apply merge entries to STATE
 */
export async function executeAction(
  action: ActionModel,
  state: StateManager,
  hooks: HookRegistry,
  sceneId = '(unknown)',
): Promise<ActionExecutionResult> {
  // Actions without a compute block or prog are no-ops (no graph, no merge).
  if (!action.compute?.prog) {
    return {
      actionId: action.id,
      computeRootValue: buildNull('missing'),
      bindingValues: {},
      stateAfterMerge: state,
      publishOutcomes: [],
    };
  }

  // Step 1: resolve prepare entries into injected binding values.
  const preparedValues = await resolveActionPrepare(action.prepare ?? [], state, hooks, action.id);

  // Step 2: translate ProgModel + injected values → ExecutionContext.
  const builtCtx = buildContextFromProg(action.compute.prog, preparedValues, action.id);

  // Step 3: validate the execution context.
  const validatedCtx = assertValidContext(builtCtx.exec);

  // Step 4: execute all bindings in declaration (topological) order.
  // The converter guarantees that each binding's dependencies appear before it,
  // so a single forward pass with an accumulated valueTable is sufficient — no
  // binding is ever executed twice, including side-branch bindings not reachable
  // from the root.
  //
  // updatedTable intentionally accumulates computed values across the forward pass
  // so later bindings can depend on earlier function bindings without re-execution.
  const updatedTable: Record<string, AnyValue> = { ...validatedCtx.valueTable };
  const bindingValues: Record<string, AnyValue> = {};

  // Build once — funcTable is stable across the loop; only valueTable grows.
  const returnIdToFuncId = buildReturnIdToFuncIdMap(validatedCtx);
  const treeCache = new Map<FuncId, ExecutionTree>();

  for (const binding of action.compute.prog.bindings) {
    const valueId = builtCtx.nameToValueId[binding.name];

    if (!Object.hasOwn(updatedTable, valueId) && binding.expr) {
      const funcId = builtCtx.getFuncId(binding.name)!;
      const bindingCtx = { ...validatedCtx, valueTable: updatedTable };
      let tree = treeCache.get(funcId);
      if (!tree) {
        tree = buildExecutionTree(funcId, bindingCtx, new Set(), new Map(), returnIdToFuncId);
        treeCache.set(funcId, tree);
      }
      const result = executeTree(tree, bindingCtx);
      mergeValueTable(updatedTable, result.updatedValueTable);

      if (!Object.hasOwn(updatedTable, valueId)) {
        throw new SceneRuntimeError(
          'OutOfOrderBinding',
          sceneId,
          `function binding "${binding.name}" returned no value — bindings may be out of topological order`,
        );
      }
    }

    const v = updatedTable[valueId];
    if (v !== undefined) bindingValues[binding.name] = v;
  }

  const rootValueId = builtCtx.nameToValueId[action.compute.root];
  const computeRootValue = updatedTable[rootValueId] ?? buildNull('missing');

  // Step 5: apply merge entries — each write returns a new StateManager.
  let mergedState = state;
  for (const entry of action.merge ?? []) {
    const bindingVal = bindingValues[entry.binding];
    if (bindingVal !== undefined) {
      mergedState = mergedState.write(entry.toState, bindingVal);
    }
  }

  // Step 6: invoke publish hooks in declaration order with the final merged state.
  const finalStateSnapshot = mergedState.snapshot();
  const publishOutcomes: PublishHookOutcome[] = [];
  for (const hookName of action.publish ?? []) {
    const hook = hooks.publish[hookName];
    if (!hook) continue;
    const ctx: PublishHookContext = {
      actionId: action.id,
      hookName,
      state: () => finalStateSnapshot,
    };
    try {
      await hook(ctx);
      publishOutcomes.push({ hookName, status: 'ok' });
    } catch (err) {
      publishOutcomes.push({ hookName, status: 'error', message: String(err) });
    }
  }

  return {
    actionId: action.id,
    computeRootValue,
    bindingValues,
    stateAfterMerge: mergedState,
    publishOutcomes,
  };
}

// Mutates accumulator — intentional; this is the local mutable value table for this action's forward pass.
function mergeValueTable(accumulator: Record<string, AnyValue>, source: Readonly<Record<string, AnyValue>>): void {
  for (const [id, value] of Object.entries(source)) {
    accumulator[id] = value;
  }
}
