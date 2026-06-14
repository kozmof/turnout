import { describe, expect, it } from "vitest";
import {
  createEmptySequenceError,
  createFunctionExecutionError,
  createInvalidTreeNodeError,
  createMissingDefinitionError,
  createMissingDependencyError,
  createMissingValueError,
  isGraphExecutionError,
} from "./errors.js";

describe("graph execution errors", () => {
  it("creates typed graph execution errors", () => {
    expect(createMissingDependencyError("v_missing" as any, "f_dep" as any)).toMatchObject({
      name: "MissingDependencyError",
      kind: "missingDependency",
      missingId: "v_missing",
      dependentId: "f_dep",
    });

    expect(createMissingDefinitionError("pd_missing" as any, "f1" as any)).toMatchObject({
      name: "MissingDefinitionError",
      kind: "missingDefinition",
      missingDefId: "pd_missing",
      funcId: "f1",
    });

    const cause = new Error("boom");
    expect(createFunctionExecutionError("f1" as any, "failed", cause)).toMatchObject({
      name: "FunctionExecutionError",
      kind: "functionExecution",
      funcId: "f1",
      message: "failed",
      cause,
    });

    expect(createEmptySequenceError("pipe1" as any)).toMatchObject({
      name: "EmptySequenceError",
      kind: "emptySequence",
      funcId: "pipe1",
    });

    expect(createMissingValueError("v1" as any)).toMatchObject({
      name: "MissingValueError",
      kind: "missingValue",
      valueId: "v1",
    });

    expect(createInvalidTreeNodeError("node1" as any, "bad shape")).toMatchObject({
      name: "InvalidTreeNodeError",
      kind: "invalidTreeNode",
      nodeId: "node1",
      message: "bad shape",
    });
  });

  it("recognizes graph execution errors only by supported kind", () => {
    expect(isGraphExecutionError(createMissingValueError("v1" as any))).toBe(true);
    expect(isGraphExecutionError(new Error("plain"))).toBe(false);
    expect(isGraphExecutionError(Object.assign(new Error("wrong"), { kind: "unknown" }))).toBe(
      false,
    );
    expect(isGraphExecutionError({ kind: "missingValue" })).toBe(false);
  });
});
