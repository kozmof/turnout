import type { StateManager } from "./state/state-manager.js";
import type {
  ActionTrace,
  ExecutionOptions,
  HarnessResult,
  ExtendHookImpl,
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
  useExtendHook(name: string, handler: ExtendHookImpl): Runner<R>;
  usePublishHook(name: string, handler: PublishHookImpl): Runner<R>;
  isDone(): boolean;
  next(steps?: number): Promise<Array<Exclude<RunnerStepResult, { done: true }>>>;
  run(): Promise<R>;
  runAsync(): AsyncGenerator<RunnerStepResult>;
  result(): R;
  partialState(): StateManager;
  /**
   * Give the engine handle back without running to completion.
   *
   * A runner takes its handle when it is created, not when it is first stepped,
   * so one that is built and then dropped holds a handle for the life of the
   * process — handles are never recycled. Declaring it with `using` closes it on
   * the way out of the block whatever happens:
   *
   * ```ts
   * using runner = createRunner(model, options);
   * const result = await runner.run();
   * ```
   *
   * Idempotent, and harmless after a completed run: `run()` has already closed
   * the handle, and `result()` and `partialState()` keep answering from the
   * state captured when it closed. On an unfinished run this is the same close
   * an abort performs — the partial state is captured, the handle goes back, and
   * stepping again is refused.
   */
  [Symbol.dispose](): void;
};
