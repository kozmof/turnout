// Universal exports — safe for client and server environments.
export { createRunner, createSceneRunner, createRouteRunner } from './runner.js';
export type { Runner, RunnerOptions, RunnerStepResult } from './runner.js';
export { runHarness } from './harness/harness.js';
export type {
  ExecutionOptions,
  HarnessOptions,
  HarnessResult,
  HookRegistry,
  PrepareHookImpl,
  PublishHookImpl,
  PublishHookOutcome,
  PrepareHookContext,
  PublishHookContext,
  ActionTrace,
  SceneTrace,
  RouteTrace,
  ExecutionTrace,
} from './types/harness-types.js';
export type { TurnModel } from './types/turnout-model_pb.js';
export { stateManagerFromUnchecked, stateManagerFromStrict, stateManagerFromSchema } from './state/state-manager.js';
export type { StateManager, StateReader } from './state/state-manager.js';
export { executeSceneSafe } from './executor/scene-executor.js';
export type { SceneResult, SceneExecutionResult } from './executor/scene-executor.js';
export { isSceneRuntimeError } from './executor/errors.js';
export type { SceneRuntimeError, SceneErrorCode, SceneInternalErrorCode } from './executor/errors.js';
export { executeRouteSafe } from './executor/route-executor.js';
export type { RouteResult, RouteWarning, RouteExecutionResult } from './executor/route-executor.js';

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
