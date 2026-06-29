import { describe, expect, it } from "vitest";
import { buildContextFromProg, buildSpec } from "../src/executor/hcl-context-builder.js";
import { executorTestHooks } from "../src/executor/test-support.js";
import {
  assertArgModelVariant,
  assertBindingHasValue,
  toCombineArgRef,
  toFuncId,
  toValueId,
} from "../src/executor/dynamic-boundary.js";
import type { ArgModel, BindingModel, ProgModel } from "../src/types/turnout-model_pb.js";

describe("executor hardening", () => {
  it("rejects combine expressions with more than 2 args", () => {
    const prog = {
      name: "wide_combine",
      bindings: [
        { name: "x", type: "number", value: 1 },
        {
          name: "result",
          type: "number",
          expr: { combine: { fn: "add", args: [{ ref: "x" }, { lit: 1 }, { lit: 2 }] } },
        },
      ],
    } as unknown as ProgModel;

    expect(() => buildSpec(prog, {})).toThrow("combine expr has 3 arg(s); expected 2");
  });

  it("rejects pipe steps with more than 2 args", () => {
    const prog = {
      name: "wide_pipe",
      bindings: [
        { name: "x", type: "number", value: 1 },
        {
          name: "result",
          type: "number",
          expr: {
            pipe: {
              params: [{ paramName: "input", sourceIdent: "x" }],
              steps: [{ fn: "add", args: [{ ref: "input" }, { lit: 1 }, { lit: 2 }] }],
            },
          },
        },
      ],
    } as unknown as ProgModel;

    expect(() => buildSpec(prog, {})).toThrow('pipe step 0 ("add") has 3 arg(s); expected 2');
  });

  it("rejects cond expressions with missing required fields", () => {
    const base = { name: "x", type: "number", value: 1 };
    const missingCondition = {
      name: "missing_condition",
      bindings: [
        base,
        {
          name: "result",
          type: "number",
          expr: { cond: { then: { ref: "x" }, elseBranch: { ref: "x" } } },
        },
      ],
    } as unknown as ProgModel;
    const missingThen = {
      name: "missing_then",
      bindings: [
        base,
        {
          name: "result",
          type: "number",
          expr: { cond: { condition: { lit: true }, elseBranch: { ref: "x" } } },
        },
      ],
    } as unknown as ProgModel;
    const missingElse = {
      name: "missing_else",
      bindings: [
        base,
        {
          name: "result",
          type: "number",
          expr: { cond: { condition: { lit: true }, then: { ref: "x" } } },
        },
      ],
    } as unknown as ProgModel;

    expect(() => buildSpec(missingCondition, {})).toThrow("cond expr is missing condition");
    expect(() => buildSpec(missingThen, {})).toThrow("cond expr is missing then branch");
    expect(() => buildSpec(missingElse, {})).toThrow("cond expr is missing else branch");
  });

  it("rejects cond transform conditions and non-value branch refs", () => {
    const transformCondition = {
      name: "bad_transform_condition",
      bindings: [
        { name: "x", type: "number", value: 1 },
        {
          name: "result",
          type: "number",
          expr: {
            cond: {
              condition: { transform: { ref: "x", fn: ["transformFnNumber", "pass"] } },
              then: { ref: "x" },
              elseBranch: { ref: "x" },
            },
          },
        },
      ],
    } as unknown as ProgModel;
    const functionBranchRef = {
      name: "bad_function_branch",
      bindings: [
        { name: "flag", type: "bool", value: true },
        { name: "x", type: "number", value: 1 },
        {
          name: "fn",
          type: "number",
          expr: { combine: { fn: "add", args: [{ ref: "x" }, { lit: 1 }] } },
        },
        {
          name: "result",
          type: "number",
          expr: {
            cond: { condition: { ref: "flag" }, then: { ref: "fn" }, elseBranch: { ref: "x" } },
          },
        },
      ],
    } as unknown as ProgModel;

    expect(() => buildSpec(transformCondition, {})).toThrow(
      "cond condition cannot be a transform reference",
    );
    expect(() => buildSpec(functionBranchRef, {})).toThrow(
      "cond then-branch resolved to a non-string ref",
    );
  });

  it("supports prototype-named bindings without treating them as injected values", () => {
    const prog = {
      name: "prototype_binding",
      bindings: [{ name: "constructor", type: "number", value: 7 }],
    } as unknown as ProgModel;

    const spec = buildSpec(prog, {});
    const built = buildContextFromProg(prog, {});

    expect(Object.hasOwn(spec, "constructor")).toBe(true);
    expect(built.resolve("constructor").kind).toBe("value");
  });

  it("rejects inherited prototype names as function aliases", () => {
    const prog = {
      name: "prototype_function",
      bindings: [
        { name: "x", type: "number", value: 1 },
        {
          name: "out",
          type: "number",
          expr: { combine: { fn: "constructor", args: [{ ref: "x" }, { lit: 1 }] } },
        },
      ],
    } as unknown as ProgModel;

    expect(() => buildSpec(prog, {})).toThrow("unknown HCL function name");
  });

  it("exercises dynamic boundary guards and casts", () => {
    expect(toFuncId("fn_id")).toBe("fn_id");
    expect(toValueId("value_id")).toBe("value_id");
    expect(toCombineArgRef("arg_id")).toBe("arg_id");

    expect(() =>
      assertBindingHasValue({ name: "v", value: 1 } as unknown as BindingModel, "ctx"),
    ).not.toThrow();
    expect(() =>
      assertBindingHasValue({ name: "f", expr: { combine: {} } } as unknown as BindingModel, "ctx"),
    ).not.toThrow();
    expect(() =>
      assertBindingHasValue({ name: "missing" } as unknown as BindingModel, "ctx"),
    ).toThrow("has neither value nor expr");

    expect(() =>
      assertArgModelVariant({ lit: 1 } as unknown as ArgModel, "ctx", "arg"),
    ).not.toThrow();
    expect(() => assertArgModelVariant({} as unknown as ArgModel, "ctx", "arg")).toThrow("found 0");
    expect(() =>
      assertArgModelVariant({ ref: "x", lit: 1 } as unknown as ArgModel, "ctx", "arg"),
    ).toThrow("found 2");
  });

  it("clears executor context caches for test isolation", () => {
    const prog = {
      name: "cache_prog",
      bindings: [{ name: "x", type: "number", value: 1 }],
    } as unknown as ProgModel;

    const before = buildContextFromProg(prog, {});
    expect(buildContextFromProg(prog, {})).toBe(before);
    executorTestHooks.clearContextCaches();
    expect(buildContextFromProg(prog, {})).not.toBe(before);
  });
});
