// Node.js only — loads models from disk before delegating to the universal harness.
import type { HarnessResult, HookRegistry } from '../types/harness-types.js';
import type { AnyValue } from 'turnout';
import { runConverter, loadJsonModel } from './bridge.js';
import { runHarness } from '../harness/harness.js';

export type ServerHarnessOptions = {
  /** Path to a .turn file — the Go converter will be invoked to produce JSON. */
  turnFile?: string;
  /** Path to a pre-converted .json file — skips the converter invocation. */
  jsonFile?: string;
  /**
   * ID of the scene or route to execute.
   * If it matches a route.id, the route executor is used.
   * If it matches a scene.id, the scene executor is used directly.
   */
  entryId: string;
  /** Initial STATE values, keyed by dotted path ("namespace.field"). */
  initialState: Record<string, AnyValue>;
  /** Optional hook implementations for from_hook prepare entries. */
  hooks?: HookRegistry;
};

/**
 * Server-only harness entry point.
 *
 * Loads a TurnModel from a `.turn` file (via Go converter) or a pre-built
 * `.json` file, then delegates to the universal `runHarness`.
 *
 * Do not use this in browser or edge environments — it requires Node.js
 * `child_process` and `fs`. Use `runHarness` directly when the model is
 * already available as a parsed object.
 */
export function runServerHarness(options: ServerHarnessOptions): HarnessResult {
  let model;
  if (options.turnFile) {
    model = runConverter(options.turnFile);
  } else if (options.jsonFile) {
    model = loadJsonModel(options.jsonFile);
  } else {
    throw new Error('runServerHarness: either turnFile or jsonFile must be provided');
  }

  return runHarness({
    model,
    entryId: options.entryId,
    initialState: options.initialState,
    hooks: options.hooks,
  });
}
