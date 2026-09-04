import { describe, it, expect } from "vitest";
import { ctx } from "./context.js";
import { combine, pipe, cond } from "./functions.js";
import { ref } from "./values.js";
import { isBuilderValidationError } from "./errors.js";
import { buildRecord, buildNumber } from "../../state-control/value-builders.js";
import { inferFuncReturnType } from "../runtime/typeInference.js";
import { inferGraphFunctionTypes, getPresetMetadata } from "../../zig-runtime/preset-metadata.js";
import { executeGraph } from "../runtime/exec/executeGraph.js";
import { assertValidContext } from "../runtime/validateContext.js";
import type {
  ExecutionContext,
  FuncId,
  TransformFnNames,
  CombineDefineId,
  PipeDefineId,
} from "../types.js";

type TransformPair = { a: readonly TransformFnNames[]; b: readonly TransformFnNames[] };

/** Reads both transform chains the builder chose for a combine definition. */
function transformsForDef(
  exec: ExecutionContext,
  defId: CombineDefineId | PipeDefineId,
): TransformPair {
  const combineDefs: Readonly<Record<string, { transformFn: TransformPair }>> =
    exec.combineFuncDefTable;
  const def = combineDefs[defId];
  if (def === undefined) throw new Error(`no combine definition for ${defId}`);
  return { a: def.transformFn.a, b: def.transformFn.b };
}

/** Reads the transform chains the builder chose for one step of a pipe function. */
function stepTransforms(
  exec: ExecutionContext,
  pipeFuncId: FuncId,
  stepIndex: number,
): TransformPair {
  const entry = exec.funcTable[pipeFuncId];
  if (entry === undefined) throw new Error(`no funcTable entry for ${pipeFuncId}`);
  const pipeDefs: Readonly<
    Record<string, { sequence: readonly { defId: CombineDefineId | PipeDefineId }[] }>
  > = exec.pipeFuncDefTable;
  const def = pipeDefs[entry.defId];
  if (def === undefined) throw new Error(`no pipe definition for ${pipeFuncId}`);
  const step = def.sequence[stepIndex];
  if (step === undefined) throw new Error(`no step ${String(stepIndex)} in ${pipeFuncId}`);
  return transformsForDef(exec, step.defId);
}

/** Reads the transform chain the builder chose for a combine function's `a` argument. */
function transformForArgA(exec: ExecutionContext, funcId: FuncId): readonly TransformFnNames[] {
  const entry = exec.funcTable[funcId];
  if (entry === undefined) throw new Error(`no funcTable entry for ${funcId}`);
  const combineDefs: Readonly<Record<string, { transformFn: { a: readonly TransformFnNames[] } }>> =
    exec.combineFuncDefTable;
  const def = combineDefs[entry.defId];
  if (def === undefined) throw new Error(`no combine definition for ${funcId}`);
  return def.transformFn.a;
}

describe("Zig-backed builder return-type inference", () => {
  describe("cond branch agreement", () => {
    it("rejects a cond whose branches return different types", () => {
      const build = (): unknown =>
        ctx({
          c: true,
          n1: 1,
          n2: 2,
          s1: "a",
          s2: "b",
          thenF: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
          elseF: combine("combineFnString::concat", { a: "s1", b: "s2" }),
          k: cond("c", { then: "thenF", else: "elseF" }),
          use: combine("combineFnNumber::add", { a: ref.output("k"), b: "n1" }),
        });

      expect(build).toThrow(/then branch returns 'number' but else branch returns 'string'/);
    });

    it("reports the mismatch as a builder validation error carrying both types", () => {
      let caught: unknown;
      try {
        ctx({
          c: true,
          n1: 1,
          s1: "a",
          thenF: combine("combineFnNumber::add", { a: "n1", b: "n1" }),
          elseF: combine("combineFnString::concat", { a: "s1", b: "s1" }),
          k: cond("c", { then: "thenF", else: "elseF" }),
        });
      } catch (error) {
        caught = error;
      }

      expect(isBuilderValidationError(caught)).toBe(true);
      expect(caught).toMatchObject({
        kind: "branchTypeMismatch",
        funcId: "k",
        thenType: "number",
        elseType: "string",
      });
    });

    it("accepts a cond whose branches agree and types its output from Zig", () => {
      const context = ctx({
        c: false,
        n1: 1,
        n2: 2,
        thenF: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
        elseF: combine("combineFnNumber::multiply", { a: "n1", b: "n2" }),
        k: cond("c", { then: "thenF", else: "elseF" }),
        use: combine("combineFnNumber::add", { a: ref.output("k"), b: "n1" }),
      });

      expect(transformForArgA(context.exec, context.ids.use)).toEqual(["transformFnNumber::pass"]);

      const result = executeGraph(context.ids.use, assertValidContext(context.exec));
      expect(result.value.value).toBe(3);
    });
  });

  describe("builder inference agrees with Zig on the finished context", () => {
    it("matches Zig for combine, pipe, and cond outputs", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        c: true,
        sum: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
        text: combine("combineFnString::concat", { a: "n1", b: "n2" }),
        chain: pipe({ x: "n1", y: "n2" }, [
          combine("combineFnNumber::multiply", { a: "x", b: "y" }),
          combine("combineFnNumber::greaterThan", { a: ref.step("chain", 0), b: "x" }),
        ]),
        branchy: cond("c", { then: "sum", else: "sum" }),
      });

      expect(inferFuncReturnType(context.ids.sum, context.exec)).toBe("number");
      expect(inferFuncReturnType(context.ids.chain, context.exec)).toBe("boolean");
      expect(inferFuncReturnType(context.ids.branchy, context.exec)).toBe("number");
    });

    it("resolves a forward reference to a cond declared later in the spec", () => {
      const context = ctx({
        c: true,
        n1: 1,
        use: combine("combineFnNumber::add", { a: ref.output("later"), b: "n1" }),
        thenF: combine("combineFnNumber::add", { a: "n1", b: "n1" }),
        elseF: combine("combineFnNumber::multiply", { a: "n1", b: "n1" }),
        later: cond("c", { then: "thenF", else: "elseF" }),
      });

      expect(transformForArgA(context.exec, context.ids.use)).toEqual(["transformFnNumber::pass"]);
    });

    it("types a reference to a pipe output from its last step", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        flag: true,
        // Last step returns boolean, so the pipe's output type is boolean even
        // though every earlier step is numeric.
        chain: pipe({ x: "n1", y: "n2" }, [
          combine("combineFnNumber::add", { a: "x", b: "y" }),
          combine("combineFnNumber::greaterThan", { a: ref.step("chain", 0), b: "x" }),
        ]),
        useChain: combine("combineFnBoolean::and", { a: ref.output("chain"), b: "flag" }),
      });

      expect(transformForArgA(context.exec, context.ids.useChain)).toEqual([
        "transformFnBoolean::pass",
      ]);
      expect(inferFuncReturnType(context.ids.chain, context.exec)).toBe("boolean");

      // (2 + 3) > 2 is true, and true && true is true.
      const result = executeGraph(context.ids.useChain, assertValidContext(context.exec));
      expect(result.value.value).toBe(true);
    });
  });

  describe("pipe step argument transforms", () => {
    it("types a step argument from the argument, not from the step's return type", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        // greaterThan takes numbers but returns a boolean. Both arguments must
        // still get the number pass transform.
        chain: pipe({ x: "n1", y: "n2" }, [
          combine("combineFnNumber::greaterThan", { a: "x", b: "y" }),
        ]),
      });

      expect(stepTransforms(context.exec, context.ids.chain, 0)).toEqual({
        a: ["transformFnNumber::pass"],
        b: ["transformFnNumber::pass"],
      });

      const result = executeGraph(context.ids.chain, assertValidContext(context.exec));
      expect(result.value.value).toBe(false);
    });

    it("types a step argument that reads a context value directly", () => {
      const context = ctx({
        n1: 10,
        limit: 4,
        chain: pipe({ x: "n1" }, [combine("combineFnNumber::lessThan", { a: "x", b: "limit" })]),
      });

      expect(stepTransforms(context.exec, context.ids.chain, 0)).toEqual({
        a: ["transformFnNumber::pass"],
        b: ["transformFnNumber::pass"],
      });

      const result = executeGraph(context.ids.chain, assertValidContext(context.exec));
      expect(result.value.value).toBe(false);
    });

    it("types a step argument that references another function's output", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        flag: true,
        sum: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
        chain: pipe({ p: "flag" }, [
          combine("combineFnNumber::greaterThan", { a: ref.output("sum"), b: "n1" }),
        ]),
      });

      expect(stepTransforms(context.exec, context.ids.chain, 0)).toEqual({
        a: ["transformFnNumber::pass"],
        b: ["transformFnNumber::pass"],
      });
    });
  });

  describe("functions Zig cannot type", () => {
    it("reports a declared but untypeable function distinctly from a missing one", () => {
      const build = (): unknown =>
        ctx({
          n1: 1,
          // An empty pipe has no last step, so Zig declines to type it.
          empty: pipe({ x: "n1" }, []),
          use: combine("combineFnNumber::add", { a: ref.output("empty"), b: "n1" }),
        });

      expect(build).toThrow(/cannot infer the return type of function 'empty'/);
    });

    it("still reports an undeclared function as a missing reference", () => {
      const build = (): unknown =>
        ctx({
          n1: 1,
          use: combine("combineFnNumber::add", { a: ref.output("nope"), b: "n1" }),
        });

      expect(build).toThrow(/undefined/i);
    });
  });

  describe("batched Zig inference ABI", () => {
    it("returns types positionally and agrees with the single-function query", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        c: true,
        sum: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
        cmp: combine("combineFnNumber::greaterThan", { a: "n1", b: "n2" }),
        branchy: cond("c", { then: "sum", else: "sum" }),
      });

      const ids = [context.ids.branchy, context.ids.sum, context.ids.cmp];
      const batched = inferGraphFunctionTypes(ids, context.exec);

      expect(batched).toEqual(["number", "number", "boolean"]);
      expect(batched).toEqual(ids.map((id) => inferFuncReturnType(id, context.exec)));
    });

    it("returns null for unknown ids without disturbing the others", () => {
      const context = ctx({
        n1: 2,
        n2: 3,
        sum: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
      });

      expect(inferGraphFunctionTypes(["nope", context.ids.sum], context.exec)).toEqual([
        null,
        "number",
      ]);
    });

    it("returns an empty list without calling Zig", () => {
      expect(inferGraphFunctionTypes([], {})).toEqual([]);
    });
  });
});

describe("combine argument arity", () => {
  const record = buildRecord({ hp: buildNumber(1) });

  it("keeps the third argument's transform for a 3-arity combine", () => {
    const context = ctx({
      rec: record,
      key: "hp",
      n: 42,
      put: combine("combineFnRecord::set", {
        a: "rec",
        b: "key",
        c: ref.transform("n", "transformFnNumber::toStr"),
      }),
    });

    const entry = context.exec.funcTable[context.ids.put]!;
    const defs: Readonly<Record<string, { transformFn: { c?: readonly TransformFnNames[] } }>> =
      context.exec.combineFuncDefTable;
    expect(defs[entry.defId]?.transformFn.c).toEqual(["transformFnNumber::toStr"]);

    // The transform must actually run: 42 is stored as the string "42".
    const result = executeGraph(context.ids.put, assertValidContext(context.exec));
    expect(result.value.value).toEqual({ hp: { symbol: "string", value: "42", tags: [] } });
  });

  it("does not merge definitions that differ only in the third argument", () => {
    const context = ctx({
      rec: record,
      key: "hp",
      n: 42,
      plain: combine("combineFnRecord::set", { a: "rec", b: "key", c: "n" }),
      shifted: combine("combineFnRecord::set", {
        a: "rec",
        b: "key",
        c: ref.transform("n", "transformFnNumber::toStr"),
      }),
    });

    const plain = context.exec.funcTable[context.ids.plain]!;
    const shifted = context.exec.funcTable[context.ids.shifted]!;
    expect(plain.defId).not.toBe(shifted.defId);
    expect(Object.keys(context.exec.combineFuncDefTable)).toHaveLength(2);
  });

  it("omits the third slot for a 2-arity combine", () => {
    const context = ctx({
      n1: 1,
      n2: 2,
      sum: combine("combineFnNumber::add", { a: "n1", b: "n2" }),
    });

    const entry = context.exec.funcTable[context.ids.sum]!;
    const defs: Readonly<Record<string, { transformFn: Record<string, unknown> }>> =
      context.exec.combineFuncDefTable;
    expect(Object.keys(defs[entry.defId]!.transformFn)).toEqual(["a", "b"]);
  });

  it("reports arity through the Zig metadata op", () => {
    expect(getPresetMetadata("combineFnRecord::set").arity).toBe(3);
    expect(getPresetMetadata("combineFnNumber::add").arity).toBe(2);
    expect(getPresetMetadata("combineFnNumber::nope").arity).toBeNull();
  });
});
