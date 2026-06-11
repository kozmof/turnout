import type { AnyValue } from 'runtime';
import type { StateManager } from '../state/state-manager.js';
import type { PublishHookOutcome } from '../types/harness-types.js';

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
};
