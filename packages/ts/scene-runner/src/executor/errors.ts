// ─────────────────────────────────────────────────────────────────────────────
// Structured runtime error classes for the scene-runner executor layer.
//
// All three classes extend Error so they can be thrown and caught normally,
// but also carry typed fields that callers can inspect without parsing messages.
// ─────────────────────────────────────────────────────────────────────────────

export type PrepareErrorCode =
  | 'MissingStateBinding'
  | 'UnregisteredHook'
  | 'MissingHookField'
  | 'MissingActionBinding';

export class PrepareError extends Error {
  readonly code: PrepareErrorCode;
  readonly actionId: string;

  constructor(code: PrepareErrorCode, actionId: string, detail: string) {
    super(`[action: ${actionId}] ${detail}`);
    this.name = 'PrepareError';
    this.code = code;
    this.actionId = actionId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/** Error codes callers are expected to handle — recoverable or routing-relevant conditions. */
export type SceneErrorCode =
  | 'UnknownAction'
  | 'MaxStepsExceeded'
  | 'UnknownFunction'
  | 'DuplicateActionId'
  | 'UnknownArgModel';

/** Error codes that indicate a malformed model or internal invariant violation. */
export type SceneInternalErrorCode =
  | 'OutOfOrderBinding'
  | 'CompilerBug'
  | 'UnsupportedConstruct'
  | 'IncompleteScene';

export class SceneRuntimeError extends Error {
  readonly code: SceneErrorCode | SceneInternalErrorCode;
  readonly sceneId: string;

  constructor(code: SceneErrorCode | SceneInternalErrorCode, sceneId: string, detail: string) {
    super(`Scene "${sceneId}": ${detail}`);
    this.name = 'SceneRuntimeError';
    this.code = code;
    this.sceneId = sceneId;
  }
}

export function isSceneRuntimeError(err: unknown): err is SceneRuntimeError {
  return err instanceof SceneRuntimeError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type RunnerErrorCode =
  | 'LateHookRegistration'
  | 'InvalidStepCount'
  | 'IncompleteExecution';

export class RunnerError extends Error {
  readonly code: RunnerErrorCode;

  constructor(code: RunnerErrorCode, detail: string) {
    super(`Runner: ${detail}`);
    this.name = 'RunnerError';
    this.code = code;
  }
}

export function isRunnerError(err: unknown): err is RunnerError {
  return err instanceof RunnerError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type StateErrorCode =
  | 'ReservedPath'
  | 'UnknownPath'
  | 'TypeMismatch'
  | 'UnknownSchemaType'
  | 'InvalidLiteral';

export class StateError extends Error {
  readonly code: StateErrorCode;
  readonly path?: string;

  constructor(code: StateErrorCode, detail: string, path?: string) {
    super(`StateManager: ${detail}`);
    this.name = 'StateError';
    this.code = code;
    this.path = path;
  }
}

export function isStateError(err: unknown): err is StateError {
  return err instanceof StateError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type ModelValidationErrorCode = 'InvalidModel';

export class ModelValidationError extends Error {
  readonly code: ModelValidationErrorCode = 'InvalidModel';
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`[turnout] Invalid model:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
    this.name = 'ModelValidationError';
    this.errors = errors;
  }
}

export function isModelValidationError(err: unknown): err is ModelValidationError {
  return err instanceof ModelValidationError;
}

// ─────────────────────────────────────────────────────────────────────────────

export type RouteErrorCode = 'UnknownScene' | 'NoEntryAction' | 'MaxRouteTransitionsExceeded';

export class RouteRuntimeError extends Error {
  readonly code: RouteErrorCode;
  readonly routeId: string;

  constructor(code: RouteErrorCode, routeId: string, detail: string) {
    super(`Route "${routeId}": ${detail}`);
    this.name = 'RouteRuntimeError';
    this.code = code;
    this.routeId = routeId;
  }
}
