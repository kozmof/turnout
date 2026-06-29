import { buildNull, buildArray } from "runtime";
import type { AnyValue } from "runtime";
import type { PrepareEntry, NextPrepareEntry } from "../types/turnout-model_pb.js";
import type { StateReader } from "../state/state-manager.js";
import { literalToValue, protoValueToJs } from "../state/state-manager.js";
import type { HookRegistry, PrepareHookContext } from "../types/harness-types.js";
import type { ActionExecutionResult } from "./types.js";
import { UNABORTABLE } from "./types.js";
import { PrepareError } from "./errors.js";

/**
 * Returns true when any prepare entry requires an async hook call.
 * Use this to select between resolveActionPrepareSync (no hooks) and
 * resolveActionPrepare (hooks present) to avoid unnecessary Promise allocation.
 */
export function hasHookEntries(entries: PrepareEntry[]): boolean {
  return entries.some((e) => e.fromHook !== undefined);
}

/**
 * Synchronous fast path for resolveActionPrepare when all entries are from_state.
 * Call only after confirming hasHookEntries(entries) === false. Throws PrepareError
 * if a from_hook entry is encountered (guards against incorrect direct calls).
 */
export function resolveActionPrepareSync(
  entries: PrepareEntry[],
  state: StateReader,
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = Object.create(null) as Record<string, AnyValue>;
  for (const entry of entries) {
    if (entry.fromState !== undefined) {
      result[entry.binding] = state.read(entry.fromState);
    } else if (entry.fromHook !== undefined) {
      throw new PrepareError(
        "UnregisteredHook",
        "(sync-path)",
        `resolveActionPrepareSync called with a from_hook entry (binding "${entry.binding}") — use resolveActionPrepare for hook-containing prepare lists`,
      );
    }
  }
  return result;
}

/**
 * Resolve action-level prepare entries into a map of binding name → AnyValue.
 *
 * Supported sources:
 *   - from_state: reads the dotted-path value from STATE (the from_state stub)
 *   - from_hook:  calls the named hook handler and extracts the binding field
 */
export async function resolveActionPrepare(
  entries: PrepareEntry[],
  state: StateReader,
  hooks: HookRegistry,
  actionId: string,
  signal: AbortSignal = UNABORTABLE,
): Promise<Record<string, AnyValue>> {
  const result: Record<string, AnyValue> = Object.create(null) as Record<string, AnyValue>;
  const hookCache = new Map<string, Record<string, AnyValue>>();

  for (const entry of entries) {
    if (entry.fromState !== undefined) {
      result[entry.binding] = state.read(entry.fromState);
    } else if (entry.fromHook !== undefined) {
      const hookName = entry.fromHook;
      const hook = Object.hasOwn(hooks.prepare, hookName) ? hooks.prepare[hookName] : undefined;
      if (!hook) {
        throw new PrepareError(
          "UnregisteredHook",
          actionId,
          `prepare hook "${hookName}" is not registered`,
        );
      }
      let hookResult = hookCache.get(hookName);
      if (hookResult === undefined) {
        const ctx: PrepareHookContext = {
          actionId,
          hookName,
          get: (binding) => (Object.hasOwn(result, binding) ? result[binding] : undefined),
        };
        hookResult = (await hook(ctx, signal)) as Record<string, AnyValue>;
        hookCache.set(hookName, hookResult);
      }
      const val = Object.hasOwn(hookResult, entry.binding) ? hookResult[entry.binding] : undefined;
      if (val === undefined) {
        throw new PrepareError(
          "MissingHookField",
          actionId,
          `prepare hook "${hookName}" did not return field "${entry.binding}"`,
        );
      }
      if (typeof val !== "object" || val === null || !("symbol" in val)) {
        throw new PrepareError(
          "InvalidHookValue",
          actionId,
          `prepare hook "${hookName}" returned a non-AnyValue for field "${entry.binding}": ` +
            `expected a typed value (built with buildString/buildNumber/etc), got ${JSON.stringify(val)}`,
        );
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
  state: StateReader,
  prevResult: ActionExecutionResult,
): Record<string, AnyValue> {
  const result: Record<string, AnyValue> = Object.create(null) as Record<string, AnyValue>;

  for (const entry of entries) {
    if (entry.fromAction !== undefined) {
      const val = Object.hasOwn(prevResult.bindingValues, entry.fromAction)
        ? prevResult.bindingValues[entry.fromAction]
        : undefined;
      if (val === undefined) {
        throw new PrepareError(
          "MissingActionBinding",
          prevResult.actionId,
          `from_action binding "${entry.fromAction}" was not produced`,
        );
      }
      result[entry.binding] = val;
    } else if (entry.fromState !== undefined) {
      result[entry.binding] = state.read(entry.fromState);
    } else if (entry.fromLiteral !== undefined) {
      result[entry.binding] = inferLiteralValue(entry.fromLiteral);
    } else if ((entry as Record<string, unknown>).fromHook !== undefined) {
      // from_hook requires async execution — not supported in synchronous next-rule evaluate.
      // Use from_action to forward an action binding, or from_state for a state path.
      throw new PrepareError(
        "UnregisteredHook",
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
  if (typeof v === "number") return literalToValue(v, "number");
  if (typeof v === "string") return literalToValue(v, "str");
  if (typeof v === "boolean") return literalToValue(v, "bool");
  if (Array.isArray(v)) {
    const first = v[0];
    if (first === undefined) {
      throw new PrepareError(
        "InvalidHookValue",
        "(literal)",
        "cannot infer element type of empty literal array in from_literal — use a named binding with a declared type instead",
      );
    }
    if (typeof first === "number") return literalToValue(v, "arr<number>");
    if (typeof first === "string") return literalToValue(v, "arr<str>");
    if (typeof first === "boolean") return literalToValue(v, "arr<bool>");
    return buildArray([]);
  }
  return buildNull("unknown");
}
