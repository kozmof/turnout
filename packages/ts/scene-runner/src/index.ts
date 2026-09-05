// Universal exports — safe for client and server environments.
export { mergeModels, ModelMergeError } from "./merge-models.js";
export type { MergeOptions } from "./merge-models.js";
export {
  createRunner,
  createSceneRunner,
  createRouteRunner,
  prepareModel,
  PreparedModel,
} from "./runner.js";
export type { Runner, RunnerOptions, RunnerStepResult } from "./runner.js";
export { runHarness } from "./harness/harness.js";
export type {
  ExecutionOptions,
  HarnessOptions,
  HarnessResult,
  FullHarnessResult,
  FragmentHarnessResult,
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
  ExecutionWarning,
  SceneWarning,
} from "./types/harness-types.js";
export type { TurnModel } from "./types/turnout-model_pb.js";
export {
  stateManagerFromUnchecked,
  stateManagerFromStrict,
  stateManagerFromSchema,
} from "./state/state-manager.js";
export type { StateManager, StateReader } from "./state/state-manager.js";
export { executeSceneSafe } from "./scene-safe.js";
export type { SceneResult, SceneExecutionResult, SceneExecutionOptions } from "./scene-safe.js";
export {
  isSceneRuntimeError,
  isPublishHookFailedError,
  isRunnerError,
  isStateError,
  isModelValidationError,
  isRouteRuntimeError,
  RunnerError,
  StateError,
  ModelValidationError,
  RouteRuntimeError,
} from "./errors.js";
export type {
  RunnerErrorCode,
  StateErrorCode,
  ModelValidationErrorCode,
  RouteErrorCode,
  SceneRuntimeError,
  PublishHookFailedError,
  SceneErrorCode,
  SceneInternalErrorCode,
} from "./errors.js";
export { executeRouteSafe } from "./route-safe.js";
export type { RouteResult, RouteExecutionResult } from "./route-safe.js";
export { collectPublishFailures } from "./trace-utils.js";
export type { PublishFailure } from "./trace-utils.js";
