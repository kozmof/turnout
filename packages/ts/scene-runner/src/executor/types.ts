import type { AnyValue } from 'turnout';
import type { StateManager } from '../state/state-manager.js';

export type ActionExecutionResult = {
  actionId: string;
  computeRootValue: AnyValue;
  /** All prog binding values by binding name. Used for from_action resolution. */
  bindingValues: Record<string, AnyValue>;
  stateAfterMerge: StateManager;
};
