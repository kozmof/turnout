import { buildNull, buildArray } from 'runtime';
import type { AnyValue } from 'runtime';
import type { PrepareEntry, NextPrepareEntry } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import { literalToValue, protoValueToJs } from '../state/state-manager.js';
import type { HookRegistry, PrepareHookContext, PrepareHookImpl } from '../types/harness-types.js';
import type { ActionExecutionResult } from './types.js';

/**
 * Resolve action-level prepare entries into a map of binding name → AnyValue.
 *
 * Supported sources:
 *   - from_state: reads the dotted-path value from STATE (the from_state stub)
 *   - from_hook:  calls the named hook handler and extracts the binding field
 */
export function resolveActionPrepare(
  entries: PrepareEntry[],
  state: StateManager,
  hooks: HookRegistry,
  actionId: string,
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = {};
  const hookCache: Record<string, Record<string, AnyValue>> = {};

  for (const entry of entries) {
    if (entry.fromState !== undefined) {
      result[entry.binding] = state.read(entry.fromState) ?? buildNull('missing');
    } else if (entry.fromHook !== undefined) {
      const hookName = entry.fromHook;
      const hook = hooks[hookName];
      if (!hook) {
        result[entry.binding] = buildNull('missing');
      } else {
        if (!hookCache[hookName]) {
          const ctx: PrepareHookContext = {
            actionId,
            hookName,
            get: (binding) => result[binding],
          };
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          hookCache[hookName] = (hook as PrepareHookImpl)(ctx) as Record<string, AnyValue>;
        }
        result[entry.binding] = hookCache[hookName][entry.binding] ?? buildNull('missing');
      }
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
 */
export function resolveNextPrepare(
  entries: NextPrepareEntry[],
  state: StateManager,
  prevResult: ActionExecutionResult,
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = {};

  for (const entry of entries) {
    if (entry.fromAction !== undefined) {
      result[entry.binding] =
        prevResult.bindingValues[entry.fromAction] ?? buildNull('missing');
    } else if (entry.fromState !== undefined) {
      result[entry.binding] = state.read(entry.fromState) ?? buildNull('missing');
    } else if (entry.fromLiteral !== undefined) {
      result[entry.binding] = inferLiteralValue(entry.fromLiteral);
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
