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
