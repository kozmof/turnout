import type { StateManager } from "./state/state-manager.js";
import type {
  ActionTrace,
  ExecutionOptions,
  HarnessResult,
  PrepareHookImpl,
  PublishHookImpl,
} from "./types/harness-types.js";

export type RunnerOptions = ExecutionOptions;
export type RunnerStepResult =
  | { done: true }
  | { done: false; kind: "action"; sceneId: string; actionId: string; trace: ActionTrace }
  | { done: false; kind: "scene-transition"; fromSceneId: string; toSceneId: string };

/** Step-by-step execution controller for a TurnModel. */
export type Runner<R extends HarnessResult = HarnessResult> = {
  usePrepareHook(name: string, handler: PrepareHookImpl): Runner<R>;
  usePublishHook(name: string, handler: PublishHookImpl): Runner<R>;
  isDone(): boolean;
  next(steps?: number): Promise<Array<Exclude<RunnerStepResult, { done: true }>>>;
  run(): Promise<R>;
  runAsync(): AsyncGenerator<RunnerStepResult>;
  result(): R;
  partialState(): StateManager;
};
