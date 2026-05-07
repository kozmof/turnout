import { assertValidContext, buildNull, buildExecutionTree, executeTree } from 'runtime';
import type { AnyValue, FuncId, ExecutionTree } from 'runtime';
import type { ActionModel } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, PublishHookContext, PublishHookImpl } from '../types/harness-types.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import { resolveActionPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';
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
): Promise<ActionExecutionResult> {
  // Actions without a compute block are no-ops (no graph, no merge).
  if (!action.compute) {
    return {
      actionId: action.id,
      computeRootValue: buildNull('missing'),
      bindingValues: {},
      stateAfterMerge: state,
    };
  }

  if (!action.compute.prog) {
    return {
      actionId: action.id,
      computeRootValue: buildNull('missing'),
      bindingValues: {},
      stateAfterMerge: state,
    };
  }

  // Step 1: resolve prepare entries into injected binding values.
  const preparedValues = await resolveActionPrepare(action.prepare ?? [], state, hooks, action.id);

  // Step 2: translate ProgModel + injected values → ExecutionContext.
  const builtCtx = buildContextFromProg(action.compute.prog, preparedValues);

  // Step 3: validate the execution context.
  const validatedCtx = assertValidContext(builtCtx.exec);

  // Step 4: execute all bindings in declaration (topological) order.
  // The converter guarantees that each binding's dependencies appear before it,
  // so a single forward pass with an accumulated valueTable is sufficient — no
  // binding is ever executed twice, including side-branch bindings not reachable
  // from the root.
  //
  // buildExecutionTree is called once per funcId and cached: the tree structure
  // depends only on the static context (funcTable, def tables), not the valueTable.
  let updatedTable = validatedCtx.valueTable;
  const bindingValues: Record<string, AnyValue> = {};
  const treeCache = new Map<FuncId, ExecutionTree>();

  for (const binding of action.compute.prog.bindings) {
    const valueId = builtCtx.nameToValueId[binding.name];

    if (updatedTable[valueId] === undefined && binding.expr) {
      const funcId = builtCtx.getFuncId(binding.name)!;
      if (!treeCache.has(funcId)) {
        treeCache.set(funcId, buildExecutionTree(funcId, validatedCtx));
      }
      const result = executeTree(treeCache.get(funcId)!, { ...validatedCtx, valueTable: updatedTable });
      updatedTable = { ...updatedTable, ...result.updatedValueTable };

      if (updatedTable[valueId] === undefined) {
        throw new SceneRuntimeError(
          'OutOfOrderBinding',
          action.id,
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
  for (const hookName of action.publish ?? []) {
    const hook = hooks[hookName];
    if (!hook) continue;
    const ctx: PublishHookContext = {
      actionId: action.id,
      hookName,
      state: () => finalStateSnapshot,
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    await (hook as PublishHookImpl)(ctx);
  }

  return {
    actionId: action.id,
    computeRootValue,
    bindingValues,
    stateAfterMerge: mergedState,
  };
}
