import { buildNull, buildArray } from 'runtime';
import type { AnyValue } from 'runtime';
import type { PrepareEntry, NextPrepareEntry } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import { literalToValue, protoValueToJs } from '../state/state-manager.js';
import type { HookRegistry, PrepareHookContext, PrepareHookImpl } from '../types/harness-types.js';
import type { ActionExecutionResult } from './types.js';
import { PrepareError } from './errors.js';

/**
 * Resolve action-level prepare entries into a map of binding name → AnyValue.
 *
 * Supported sources:
 *   - from_state: reads the dotted-path value from STATE (the from_state stub)
 *   - from_hook:  calls the named hook handler and extracts the binding field
 */
export async function resolveActionPrepare(
  entries: PrepareEntry[],
  state: StateManager,
  hooks: HookRegistry,
  actionId: string,
): Promise<Record<string, AnyValue>> {
  const result: Record<string, AnyValue> = {};
  const hookCache: Record<string, Record<string, AnyValue>> = {};

  for (const entry of entries) {
    if (entry.fromState !== undefined) {
      const val = state.read(entry.fromState);
      if (val === undefined) {
        throw new PrepareError('MissingStateBinding', actionId, `from_state path "${entry.fromState}" is not present in state`);
      }
      result[entry.binding] = val;
    } else if (entry.fromHook !== undefined) {
      const hookName = entry.fromHook;
      const hook = hooks[hookName];
      if (!hook) {
        throw new PrepareError('UnregisteredHook', actionId, `prepare hook "${hookName}" is not registered`);
      }
      if (!hookCache[hookName]) {
        const ctx: PrepareHookContext = {
          actionId,
          hookName,
          get: (binding) => result[binding],
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        hookCache[hookName] = await (hook as PrepareHookImpl)(ctx) as Record<string, AnyValue>;
      }
      const val = hookCache[hookName][entry.binding];
      if (val === undefined) {
        throw new PrepareError('MissingHookField', actionId, `prepare hook "${hookName}" did not return field "${entry.binding}"`);
      }
      result[entry.binding] = val;
    }
  }

  return result;
}

/**
 * Resolve next-rule prepare entries into a map of binding name → AnyValue.
 *
 * Supported sources:
 *   - from_action:  reads a binding value from the previous action's result (the from_action stub)
 *   - from_state:   reads from the post-merge STATE
 *   - from_literal: converts the inline literal to a typed AnyValue
 *
 * Note: from_hook is NOT supported here — next-rule evaluation is synchronous and
 * hook calls are async. Use from_action or from_state to pass values into next rules.
 */
export function resolveNextPrepare(
  entries: NextPrepareEntry[],
  state: StateManager,
  prevResult: ActionExecutionResult,
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = {};

  for (const entry of entries) {
    if (entry.fromAction !== undefined) {
      const val = prevResult.bindingValues[entry.fromAction];
      if (val === undefined) {
        throw new PrepareError('MissingActionBinding', prevResult.actionId, `from_action binding "${entry.fromAction}" was not produced`);
      }
      result[entry.binding] = val;
    } else if (entry.fromState !== undefined) {
      const val = state.read(entry.fromState);
      if (val === undefined) {
        throw new PrepareError('MissingStateBinding', prevResult.actionId, `from_state path "${entry.fromState}" is not present in state`);
      }
      result[entry.binding] = val;
    } else if (entry.fromLiteral !== undefined) {
      result[entry.binding] = inferLiteralValue(entry.fromLiteral);
    } else if ((entry as Record<string, unknown>).fromHook !== undefined) {
      // from_hook requires async execution — not supported in synchronous next-rule evaluate.
      // Use from_action to forward an action binding, or from_state for a state path.
      throw new PrepareError(
        'UnregisteredHook',
        prevResult.actionId,
        `from_hook is not supported in next-rule prepare entries (binding "${entry.binding}"); use from_action or from_state instead`,
      );
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function inferLiteralValue(lit: unknown): AnyValue {
  const v = protoValueToJs(lit);
  if (typeof v === 'number') return literalToValue(v, 'number');
  if (typeof v === 'string') return literalToValue(v, 'str');
  if (typeof v === 'boolean') return literalToValue(v, 'bool');
  if (Array.isArray(v)) {
    const first = v[0];
    if (typeof first === 'number') return literalToValue(v, 'arr<number>');
    if (typeof first === 'string') return literalToValue(v, 'arr<str>');
    if (typeof first === 'boolean') return literalToValue(v, 'arr<bool>');
    // Empty array — no element type to infer; return a typed empty array value.
    return buildArray([]);
  }
  return buildNull('unknown');
}
