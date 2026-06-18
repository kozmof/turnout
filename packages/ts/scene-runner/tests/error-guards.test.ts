import { describe, it, expect } from "vitest";
import {
  SceneRuntimeError,
  isSceneRuntimeError,
  RunnerError,
  isRunnerError,
  StateError,
  isStateError,
  ModelValidationError,
  isModelValidationError,
  RouteRuntimeError,
  isRouteRuntimeError,
} from "../src/executor/errors.js";

// Each guard must accept its own error type and reject every other error type.
// A guard that always returned true would silently misroute error handling, so
// the negative cases are the substantive assertions here.
describe("executor error type guards", () => {
  const scene = new SceneRuntimeError("UnknownAction", "s1", "boom", { actionId: "a1" });
  const runner = new RunnerError("ConcurrentExecution", "boom");
  const state = new StateError("UnknownPath", "boom", "ns.field");
  const model = new ModelValidationError(["bad field"]);
  const route = new RouteRuntimeError("UnknownScene", "r1", "boom");
  const foreign = new Error("plain");

  it("isSceneRuntimeError", () => {
    expect(scene.code).toBe("UnknownAction");
    expect(scene.sceneId).toBe("s1");
    expect(scene.context?.actionId).toBe("a1");
    expect(isSceneRuntimeError(scene)).toBe(true);
    for (const other of [runner, state, model, route, foreign]) {
      expect(isSceneRuntimeError(other)).toBe(false);
    }
  });

  it("isRunnerError", () => {
    expect(runner.code).toBe("ConcurrentExecution");
    expect(isRunnerError(runner)).toBe(true);
    for (const other of [scene, state, model, route, foreign]) {
      expect(isRunnerError(other)).toBe(false);
    }
  });

  it("isStateError", () => {
    expect(state.code).toBe("UnknownPath");
    expect(state.path).toBe("ns.field");
    expect(isStateError(state)).toBe(true);
    for (const other of [scene, runner, model, route, foreign]) {
      expect(isStateError(other)).toBe(false);
    }
  });

  it("isModelValidationError", () => {
    expect(model.code).toBe("InvalidModel");
    expect(model.errors).toEqual(["bad field"]);
    expect(model.message).toContain("bad field");
    expect(isModelValidationError(model)).toBe(true);
    for (const other of [scene, runner, state, route, foreign]) {
      expect(isModelValidationError(other)).toBe(false);
    }
  });

  it("isRouteRuntimeError", () => {
    expect(route.code).toBe("UnknownScene");
    expect(route.routeId).toBe("r1");
    expect(isRouteRuntimeError(route)).toBe(true);
    for (const other of [scene, runner, state, model, foreign]) {
      expect(isRouteRuntimeError(other)).toBe(false);
    }
  });
});
