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
export { runConverter, loadJsonModel } from './converter/bridge.js';
export { StateManager } from './state/state-manager.js';
