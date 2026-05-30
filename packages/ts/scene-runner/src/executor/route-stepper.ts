import type { SceneBlock } from '../types/turnout-model_pb.js';
import type { StateManager } from '../state/state-manager.js';
import type { HookRegistry, ActionTrace, SceneTrace, RouteTrace } from '../types/harness-types.js';
import type { ParsedMatchArm } from './route-pattern.js';
import { selectNextScene } from './route-pattern.js';
import { createSceneExecutor } from './scene-executor.js';
import { RouteRuntimeError } from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RouteStepResult =
  | { done: false; sceneId: string; trace: ActionTrace }
  | { done: true };

export type RouteStepperResult = {
  finalState: StateManager;
  trace: RouteTrace;
};

/**
 * Step-by-step route executor.
 *
 * Mirrors the `SceneExecutor` interface: advance one action at a time via
 * `next()`, inspect `isDone()`, and retrieve the final result via `result()`.
 * Scene transitions are handled transparently inside `next()` and do not
 * consume a step — each non-done result represents one completed action.
 */
export type RouteStepper = {
  isDone(): boolean;
  currentSceneId(): string;
  /** Execute the next action, transitioning scenes as needed. */
  next(): Promise<RouteStepResult>;
  /** Returns the final result. Throws if execution is not complete. */
  result(): RouteStepperResult;
  /** State at the current point of execution. */
  partialState(): StateManager;
};

const DEFAULT_MAX_ROUTE_TRANSITIONS = 1_000;

// ─────────────────────────────────────────────────────────────────────────────
// RouteSession — encapsulates all mutable route-mode state
// ─────────────────────────────────────────────────────────────────────────────

type RouteSession = {
  routeId: string;
  parsedArms: ParsedMatchArm[];
  history: string[];
  sceneTraces: SceneTrace[];
  transitionCount: number;
  maxTransitions: number;
  currentSceneId: string;

  recordAction(actionId: string): void;
  clearHistory(): void;
  saveTrace(trace: SceneTrace): void;
  /** Returns the next scene ID or null if route is complete. Throws on limit exceeded. */
  transition(): string | null;
};

function createRouteSession(
  routeId: string,
  parsedArms: ParsedMatchArm[],
  entrySceneId: string,
  maxTransitions: number,
): RouteSession {
  const session: RouteSession = {
    routeId,
    parsedArms,
    history: [],
    sceneTraces: [],
    transitionCount: 0,
    maxTransitions,
    currentSceneId: entrySceneId,

    recordAction(actionId) {
      this.history.push(`${this.currentSceneId}.${actionId}`);
    },

    clearHistory() {
      this.history = [];
    },

    saveTrace(trace) {
      this.sceneTraces.push(trace);
    },

    transition() {
      const nextSceneId = selectNextScene(this.history, this.parsedArms, this.currentSceneId);
      // History for the finished scene is no longer needed: non-catchall arms only
      // match pattern.sceneId === currentSceneId, so prior scenes can never fire again.
      this.clearHistory();

      if (nextSceneId === null) return null;

      this.transitionCount++;
      if (this.transitionCount > this.maxTransitions) {
        throw new RouteRuntimeError(
          'MaxRouteTransitionsExceeded',
          this.routeId,
          `exceeded ${this.maxTransitions} scene transitions — possible infinite loop`,
        );
      }

      this.currentSceneId = nextSceneId;
      return nextSceneId;
    },
  };
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

function firstEntryAction(scene: SceneBlock, routeId: string): string {
  const first = scene.entryActions[0];
  if (!first) throw new RouteRuntimeError('NoEntryAction', routeId, `scene "${scene.id}" has no entry actions`);
  return first;
}

export function createRouteStepper(
  routeId: string,
  parsedArms: ParsedMatchArm[],
  entrySceneId: string,
  sceneMap: Record<string, SceneBlock>,
  initialState: StateManager,
  hooks: HookRegistry,
  maxSceneSteps?: number,
  maxRouteTransitions?: number,
): RouteStepper {
  const session = createRouteSession(
    routeId,
    parsedArms,
    entrySceneId,
    maxRouteTransitions ?? DEFAULT_MAX_ROUTE_TRANSITIONS,
  );

  let currentState = initialState;
  let done = false;

  const initialScene = sceneMap[entrySceneId];
  if (!initialScene) throw new RouteRuntimeError('UnknownScene', routeId, `entry scene "${entrySceneId}" not found`);

  let sceneExecutor = createSceneExecutor(
    initialScene,
    currentState,
    hooks,
    [firstEntryAction(initialScene, routeId)],
    maxSceneSteps,
  );

  async function next(): Promise<RouteStepResult> {
    for (;;) {
      if (!sceneExecutor.isDone()) {
        const step = await sceneExecutor.next();
        if (step.done) continue;

        session.recordAction(step.trace.actionId);
        return { done: false, sceneId: session.currentSceneId, trace: step.trace };
      }

      // Scene exhausted — finalise and attempt transition.
      const sceneResult = sceneExecutor.result();
      currentState = sceneResult.stateAfterScene;
      session.saveTrace(sceneResult.trace);

      const nextSceneId = session.transition();
      if (nextSceneId === null) {
        done = true;
        return { done: true };
      }

      const nextScene = sceneMap[nextSceneId];
      if (!nextScene) throw new RouteRuntimeError('UnknownScene', routeId, `unknown scene "${nextSceneId}"`);

      sceneExecutor = createSceneExecutor(
        nextScene,
        currentState,
        hooks,
        [firstEntryAction(nextScene, routeId)],
        maxSceneSteps,
      );
    }
  }

  return {
    isDone: () => done,

    currentSceneId: () => session.currentSceneId,

    next,

    result() {
      if (!done) throw new Error('RouteStepper: execution is not complete');
      return {
        finalState: currentState,
        trace: { routeId, scenes: session.sceneTraces },
      };
    },

    partialState: () => currentState,
  };
}
