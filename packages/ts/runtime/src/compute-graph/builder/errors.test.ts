import { describe, expect, it } from "vitest";
import {
  BuilderInvariantError,
  createUndefinedBranchError,
  createUndefinedConditionError,
  createUndefinedPipeArgumentError,
  createUndefinedPipeStepReferenceError,
  createUndefinedValueReferenceError,
  isBuilderInvariantError,
  isBuilderValidationError,
} from "./errors.js";

describe("builder validation errors", () => {
  it("creates structured undefined condition errors", () => {
    const error = createUndefinedConditionError("choose", "flag");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UndefinedConditionError");
    expect(error.kind).toBe("undefinedCondition");
    expect(error.funcId).toBe("choose");
    expect(error.conditionRef).toBe("flag");
    expect(error.message).toContain("undefined condition: 'flag'");
  });

  it("creates structured undefined branch errors", () => {
    const error = createUndefinedBranchError("choose", "else", "fallback");
    expect(error.name).toBe("UndefinedBranchError");
    expect(error.kind).toBe("undefinedBranch");
    expect(error.branchType).toBe("else");
    expect(error.branchRef).toBe("fallback");
  });

  it("creates structured undefined value reference errors", () => {
    const error = createUndefinedValueReferenceError("sum", "a", "missing");
    expect(error.name).toBe("UndefinedValueReferenceError");
    expect(error.kind).toBe("undefinedValueReference");
    expect(error.argName).toBe("a");
    expect(error.valueRef).toBe("missing");
  });

  it("creates structured pipe reference errors", () => {
    const argError = createUndefinedPipeArgumentError("pipe", "a", "missing");
    expect(argError.name).toBe("UndefinedPipeArgumentError");
    expect(argError.kind).toBe("undefinedPipeArgument");
    expect(argError.binding).toBe("missing");

    const stepError = createUndefinedPipeStepReferenceError("pipe", 2, "b", "step:9");
    expect(stepError.name).toBe("UndefinedPipeStepReferenceError");
    expect(stepError.kind).toBe("undefinedPipeStepReference");
    expect(stepError.stepIndex).toBe(2);
    expect(stepError.reference).toBe("step:9");
  });

  it("identifies builder validation errors by error instance and known kind", () => {
    expect(isBuilderValidationError(createUndefinedConditionError("f", "v"))).toBe(true);
    expect(
      isBuilderValidationError(Object.assign(new Error("x"), { kind: "undefinedBranch" })),
    ).toBe(true);
    expect(isBuilderValidationError(Object.assign(new Error("x"), { kind: "other" }))).toBe(false);
    expect(isBuilderValidationError({ kind: "undefinedBranch" })).toBe(false);
    expect(isBuilderValidationError(new Error("plain"))).toBe(false);
  });

  it("identifies BuilderInvariantError by instance", () => {
    const err = new BuilderInvariantError("MissingTableEntry", "missing 'v1'");
    expect(err.name).toBe("BuilderInvariantError");
    expect(err.code).toBe("MissingTableEntry");
    expect(err.message).toContain("[builder] missing 'v1'");
    expect(isBuilderInvariantError(err)).toBe(true);
    expect(isBuilderInvariantError(new Error("plain"))).toBe(false);
    expect(isBuilderInvariantError({ code: "MissingTableEntry" })).toBe(false);
  });
});
