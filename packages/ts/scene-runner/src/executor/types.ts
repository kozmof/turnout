import type { AnyValue } from "runtime";
import type { StateManager } from "../state/state-manager.js";
import type { PublishHookOutcome } from "../types/harness-types.js";

/** A signal that is never aborted; used as the default AbortSignal for operations that must complete. */
export const UNABORTABLE: AbortSignal = new AbortController().signal;

export type ActionExecutionResult = {
  actionId: string;
  computeRootValue: AnyValue;
  /** All prog binding values by binding name. Used for from_action resolution. */
  bindingValues: Record<string, AnyValue>;
  stateAfterMerge: StateManager;
  /** Outcomes of all publish hooks invoked for this action (empty if none). */
  publishOutcomes: PublishHookOutcome[];
  /** Non-fatal warnings from applying merge entries (e.g. binding absent from compute result). */
  mergeWarnings?: string[];
  /**
   * Dotted-path keys written during this action's merge when the StateManager has no
   * schema (created via `stateManagerFromUnchecked`). Present only when at least one
   * path was written. Callers should surface this as an `unchecked_state_write` warning
   * so trace consumers can detect unvalidated writes.
   */
  uncheckedWritePaths?: string[];
};
