import { assertValidContext, buildNull, buildExecutionTree, executeTree } from 'runtime';

const UNABORTABLE = new AbortController().signal;
import type { AnyValue, FuncId, ExecutionTree } from 'runtime';
import type { ActionModel } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, PublishHookContext } from '../types/harness-types.js';
import { buildContextFromProg } from './hcl-context-builder.js';
import type { BuiltContext } from './hcl-context-builder.js';
import { resolveActionPrepare } from './prepare-resolver.js';
import type { ActionExecutionResult } from './types.js';
import type { PublishHookOutcome } from '../types/harness-types.js';
import { SceneRuntimeError } from './errors.js';

// Trees are fully determined by funcTable, which is stable for the lifetime of
// a given BuiltContext. For pure progs, buildContextFromProg returns the same
// BuiltContext object on every call (via pureProgCtxCache), so caching trees
// here avoids rebuilding the execution graph on each action invocation.
const treesByBuiltCtx = new WeakMap<BuiltContext, Map<FuncId, ExecutionTree>>();

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
  signal: AbortSignal = UNABORTABLE,
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
  const preparedValues = await resolveActionPrepare(action.prepare ?? [], state, hooks, action.id, signal);

  // Step 2: translate ProgModel + injected values → ExecutionContext.
  const builtCtx = buildContextFromProg(action.compute.prog, preparedValues, action.id);

  // Step 3: validate the execution context.
  const validatedCtx = assertValidContext(builtCtx.getExec());

  // Step 4: execute all bindings in declaration (topological) order.
  // The converter guarantees that each binding's dependencies appear before it,
  // so a single forward pass with an accumulated valueTable is sufficient — no
  // binding is ever executed twice, including side-branch bindings not reachable
  // from the root.
  //
  // updatedTable starts as a reference to the validated context's read-only table.
  // It is copied on first write (copy-on-write) so that progs with only literal
  // bindings incur no allocation here at all.
  let updatedTable: Record<string, AnyValue> = validatedCtx.valueTable;
  const bindingValues: Record<string, AnyValue> = {};

  let ctxTrees = treesByBuiltCtx.get(builtCtx);
  if (!ctxTrees) {
    ctxTrees = new Map();
    treesByBuiltCtx.set(builtCtx, ctxTrees);
  }

  for (const binding of action.compute.prog.bindings) {
    const valueId = builtCtx.resolveValueId(binding.name);
    if (valueId === undefined) {
      throw new SceneRuntimeError(
        'OutOfOrderBinding',
        sceneId,
        `binding "${binding.name}" not found in nameToValueId — this is a compiler bug`,
      );
    }

    if (!Object.hasOwn(updatedTable, valueId) && binding.expr) {
      const resolved = builtCtx.resolve(binding.name);
      if (resolved.kind !== 'func') {
        throw new SceneRuntimeError(
          'OutOfOrderBinding',
          sceneId,
          `function binding "${binding.name}" has no funcId — binding may be missing from the execution context`,
        );
      }
      const funcId = resolved.id;
      const bindingCtx = { ...validatedCtx, valueTable: updatedTable };
      let tree = ctxTrees.get(funcId);
      if (!tree) {
        tree = buildExecutionTree(funcId, bindingCtx);
        ctxTrees.set(funcId, tree);
      }
      const result = executeTree(tree, bindingCtx);
      // Copy on first write so we never mutate validatedCtx.valueTable.
      if (updatedTable === validatedCtx.valueTable) {
        updatedTable = { ...validatedCtx.valueTable };
      }
      mergeIntoValueTable(updatedTable, result.updatedValueTable);

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

  const rootValueId = builtCtx.nameToValueId.get(action.compute.root);
  const computeRootValue = (rootValueId !== undefined ? updatedTable[rootValueId] : undefined) ?? buildNull('missing');

  // Step 5: apply merge entries in a single batch to avoid O(n) intermediate
  // StateManager allocations when multiple bindings are written back to STATE.
  let mergedState = state;
  const mergeBatch: Record<string, AnyValue> = {};
  const mergeWarnings: string[] = [];
  for (const entry of action.merge ?? []) {
    const bindingVal = bindingValues[entry.binding];
    if (bindingVal !== undefined) {
      mergeBatch[entry.toState] = bindingVal;
    } else {
      mergeWarnings.push(
        `action "${action.id}": merge entry binding "${entry.binding}" → "${entry.toState}" was absent from compute results — state not updated`,
      );
    }
  }
  if (Object.keys(mergeBatch).length > 0) {
    mergedState = mergedState.writeBatch(mergeBatch);
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
      await hook(ctx, signal);
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
    ...(mergeWarnings.length > 0 ? { mergeWarnings } : {}),
  };
}

// Mutates accumulator — intentional; this is the local mutable value table for this action's forward pass.
function mergeIntoValueTable(accumulator: Record<string, AnyValue>, source: Readonly<Record<string, AnyValue>>): void {
  for (const [id, value] of Object.entries(source)) {
    accumulator[id] = value;
  }
}
