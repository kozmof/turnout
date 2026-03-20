import { buildNull } from 'runtime';
import type { AnyValue } from 'runtime';
import type { PrepareEntry, NextPrepareEntry, Literal } from '../types/scene-model.js';
import type { StateManager } from '../state/state-manager.js';
import { literalToValue } from '../state/state-manager.js';
import type { HookRegistry } from '../types/harness-types.js';
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
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = {};

  for (const entry of entries) {
    if (entry.from_state !== undefined) {
      result[entry.binding] = state.read(entry.from_state) ?? buildNull('missing');
    } else if (entry.from_hook !== undefined) {
      const hookName = entry.from_hook;
      const hook = hooks[hookName];
      if (!hook) {
        result[entry.binding] = buildNull('missing');
      } else {
        const hookResult = hook({ readState: (p) => state.read(p) });
        result[entry.binding] = hookResult[entry.binding] ?? buildNull('missing');
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
    if (entry.from_action !== undefined) {
      result[entry.binding] =
        prevResult.bindingValues[entry.from_action] ?? buildNull('missing');
    } else if (entry.from_state !== undefined) {
      result[entry.binding] = state.read(entry.from_state) ?? buildNull('missing');
    } else if (entry.from_literal !== undefined) {
      result[entry.binding] = inferLiteralValue(entry.from_literal);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function inferLiteralValue(lit: Literal): AnyValue {
  if (typeof lit === 'number') return literalToValue(lit, 'number');
  if (typeof lit === 'string') return literalToValue(lit, 'str');
  if (typeof lit === 'boolean') return literalToValue(lit, 'bool');
  if (Array.isArray(lit)) {
    const first = lit[0];
    if (typeof first === 'number') return literalToValue(lit, 'arr<number>');
    if (typeof first === 'string') return literalToValue(lit, 'arr<str>');
    if (typeof first === 'boolean') return literalToValue(lit, 'arr<bool>');
  }
  return buildNull('unknown');
}
