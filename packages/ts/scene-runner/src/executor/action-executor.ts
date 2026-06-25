import { buildNull, buildExecutionTree, executeTree } from "runtime";
import type { AnyValue, FuncId, ExecutionTree, ValueId } from "runtime";
import type { ActionModel } from "../types/turnout-model_pb.js";
import type { StateManager } from "../state/state-manager.js";
import type { HookRegistry, PublishHookContext } from "../types/harness-types.js";
import { buildContextFromProg } from "./hcl-context-builder.js";
import type { BuiltContext } from "./hcl-context-builder.js";
import {
  resolveActionPrepare,
  resolveActionPrepareSync,
  hasHookEntries,
} from "./prepare-resolver.js";
import { type ActionExecutionResult, UNABORTABLE } from "./types.js";
import type { PublishHookOutcome } from "../types/harness-types.js";
import { PublishHookFailedError, SceneRuntimeError } from "./errors.js";

// Trees are fully determined by funcTable, which is stable for the lifetime of
// a given BuiltContext. For pure progs, buildContextFromProg returns the same
// BuiltContext object on every call (via pureProgCtxCache), so caching trees
// here avoids rebuilding the execution graph on each action invocation.
//
// For progs with injected prepare values, buildContextFromProg constructs a new
// BuiltContext on every invocation (no cache hit), so this tree cache is also
// rebuilt per invocation for those progs. That is a known cost, not a bug.
const treesByBuiltCtx = new WeakMap<BuiltContext, Map<FuncId, ExecutionTree>>();

/**
 * True for cancellation errors raised when the run's `AbortSignal` fires. The
 * runner throws a `DOMException` named "AbortError", but hooks may surface an
 * abort via a host/polyfill error object, so we match on the `name` property
 * rather than the concrete class.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name: unknown }).name === "AbortError"
  );
}

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
  sceneId = "(unknown)",
  signal: AbortSignal = UNABORTABLE,
  failOnPublishError = false,
): Promise<ActionExecutionResult> {
  // Actions without a compute block or prog are no-ops (no graph, no merge).
  if (!action.compute?.prog) {
    return {
      actionId: action.id,
      computeRootValue: buildNull("missing"),
      bindingValues: {},
      stateAfterMerge: state,
      publishOutcomes: [],
    };
  }

  // Step 1: resolve prepare entries into injected binding values.
  // Use the synchronous fast path when no from_hook entries are present to avoid
  // allocating an extra Promise on every action that is purely from_state driven.
  const prepareEntries = action.prepare ?? [];
  const preparedValues = hasHookEntries(prepareEntries)
    ? await resolveActionPrepare(prepareEntries, state, hooks, action.id, signal)
    : resolveActionPrepareSync(prepareEntries, state);

  // Step 2: translate ProgModel + injected values → ExecutionContext.
  const builtCtx = buildContextFromProg(action.compute.prog, preparedValues, action.id);

  // Step 3: retrieve the pre-validated execution context.
  const validatedCtx = builtCtx.getValidatedExec();

  // Step 4: execute all bindings in declaration (topological) order.
  // The converter guarantees that each binding's dependencies appear before it,
  // so a single forward pass with an accumulated valueTable is sufficient — no
  // binding is ever executed twice, including side-branch bindings not reachable
  // from the root.
  // Forward pass: each binding's result is accumulated into updatedTable for subsequent bindings.
  let updatedTable: Record<string, AnyValue> = { ...validatedCtx.valueTable };
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
        "OutOfOrderBinding",
        sceneId,
        `binding "${binding.name}" not found in nameToValueId — this is a compiler bug`,
      );
    }

    if (!Object.hasOwn(updatedTable, valueId) && binding.expr) {
      const resolved = builtCtx.resolve(binding.name);
      if (resolved.kind !== "func") {
        throw new SceneRuntimeError(
          "OutOfOrderBinding",
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
      for (const [id, value] of Object.entries(result.updatedValueTable) as Array<
        [ValueId, AnyValue]
      >) {
        updatedTable[id] = value;
      }

      if (!Object.hasOwn(updatedTable, valueId)) {
        throw new SceneRuntimeError(
          "OutOfOrderBinding",
          sceneId,
          `function binding "${binding.name}" returned no value — bindings may be out of topological order`,
        );
      }
    }

    const v = updatedTable[valueId];
    if (v !== undefined) bindingValues[binding.name] = v;
  }

  const rootValueId = builtCtx.resolveValueId(action.compute.root);
  const computeRootValue =
    (rootValueId !== undefined ? updatedTable[rootValueId] : undefined) ?? buildNull("missing");

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
  const mergedPaths = Object.keys(mergeBatch);
  if (mergedPaths.length > 0) {
    mergedState = mergedState.writeBatch(mergeBatch);
  }

  // Step 6: invoke publish hooks in declaration order with the final merged state.
  const finalStateSnapshot: Readonly<Record<string, AnyValue>> = mergedState.snapshot();
  const publishOutcomes: PublishHookOutcome[] = [];
  for (const hookName of action.publish ?? []) {
    if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
    const hook = hooks.publish[hookName];
    if (!hook) continue;
    const ctx: PublishHookContext = {
      actionId: action.id,
      hookName,
      state: () => finalStateSnapshot,
    };
    try {
      // Honor the hook's reported outcome: a returned `{ status: "error" }` is a
      // publish failure just like a thrown one, so it must reach the
      // failOnPublishError / collectPublishFailures paths rather than being
      // silently recorded as success. Normalize on the local `hookName` so the
      // trace key is authoritative regardless of what the hook returns.
      const outcome = await hook(ctx, signal);
      if (outcome && outcome.status === "error") {
        publishOutcomes.push({ hookName, status: "error", message: outcome.message });
      } else {
        publishOutcomes.push({ hookName, status: "ok" });
      }
    } catch (err) {
      // An abort forwarded into the hook must surface as AbortError per the
      // runner's cancellation contract, not be swallowed into a publish failure.
      if (isAbortError(err)) throw err;
      publishOutcomes.push({ hookName, status: "error", message: String(err) });
    }
  }

  // When opted in, a failed publish hook is a hard error: the action's state
  // merge has already been committed, but side effects (emails, webhooks, audit
  // writes) did not all succeed, so callers that asked to fail-fast must see it.
  if (failOnPublishError) {
    const failed = publishOutcomes.filter((o) => o.status === "error");
    if (failed.length > 0) {
      const summary = failed
        .map((o) => `${o.hookName}: ${o.status === "error" ? o.message : ""}`)
        .join("; ");
      throw new PublishHookFailedError(
        sceneId,
        `action "${action.id}": ${failed.length} publish hook(s) failed — ${summary}`,
        action.id,
        mergedState,
        publishOutcomes,
      );
    }
  }

  const uncheckedWritePaths =
    !state.isSchemaManaged() && mergedPaths.length > 0 ? mergedPaths : undefined;

  return {
    actionId: action.id,
    computeRootValue,
    bindingValues,
    stateAfterMerge: mergedState,
    publishOutcomes,
    ...(mergeWarnings.length > 0 ? { mergeWarnings } : {}),
    ...(uncheckedWritePaths !== undefined ? { uncheckedWritePaths } : {}),
  };
}
