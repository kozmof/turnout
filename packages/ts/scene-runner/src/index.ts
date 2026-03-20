// Universal exports — safe for client and server environments.
export { createRunner, Runner } from './runner.js';
export type { RunnerOptions, RunnerStepResult } from './runner.js';
export { runHarness } from './harness/harness.js';
export type {
  HarnessOptions,
  HarnessResult,
  HookRegistry,
  HookHandler,
  HookContext,
  ActionTrace,
  SceneTrace,
  RouteTrace,
  ExecutionTrace,
} from './types/harness-types.js';
export type { TurnModel } from './types/scene-model.js';
export { StateManager } from './state/state-manager.js';

// Server-only exports (Node.js) — re-exported for convenience.
// Import from 'turnout-scene-runner/server' to be explicit about the boundary.
export {
  runServerHarness,
  loadTurnFile,
  convertToHCL,
  runConverter,
  loadJsonModel,
} from './server/index.js';
export type { ServerHarnessOptions } from './server/index.js';
