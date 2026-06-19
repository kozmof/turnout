import { describe, expect, it } from "vitest";
import { executeCombineFunc } from "./exec/executeCombineFunc.js";
import { executeCondFunc } from "./exec/executeCondFunc.js";
import {
  createScopedValueTable,
  executePipeFunc,
  validateScopedValueTable,
} from "./exec/executePipeFunc.js";
import {
  buildTypeEnvironment,
  defineIdExistsInContext,
  funcIdExistsInContext,
  hasNameAndTransformFn,
  hasSymbolProperty,
  inferFuncType,
  isBaseTypeSymbol,
  isCombineDefWithBinaryFnName,
  isPipeDefWithSequence,
  isRecord,
  isStringAs,
  pipeStepDefIdExistsInContext,
  valueIdExistsInContext,
} from "./validate/utils.js";
import type { ExecutionContext, FuncArgMap, ValueId } from "../types.js";

const numberValue = (value: number) => ({
  symbol: "number",
  value,
  subSymbol: undefined,
  tags: [],
});

function emptyContext(): ExecutionContext {
  return {
    valueTable: {} as any,
    funcTable: {} as any,
    combineFuncDefTable: {} as any,
    pipeFuncDefTable: {} as any,
    condFuncDefTable: {} as any,
  };
}

describe("runtime coverage edges", () => {
  describe("validation utility guards", () => {
    it("covers record, string, base symbol, and shape guard branches", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord([])).toBe(false);
      expect(isBaseTypeSymbol("number")).toBe(true);
      expect(isBaseTypeSymbol("bogus")).toBe(false);
      expect(isBaseTypeSymbol(1)).toBe(false);
      expect(isStringAs<string>("x")).toBe(true);
      expect(isStringAs<string>(1)).toBe(false);

      expect(isCombineDefWithBinaryFnName(null)).toBe(false);
      expect(isCombineDefWithBinaryFnName({})).toBe(false);
      expect(isCombineDefWithBinaryFnName({ name: 1 })).toBe(false);
      expect(isCombineDefWithBinaryFnName({ name: "binaryFnNumber::missing" })).toBe(false);
      expect(isCombineDefWithBinaryFnName({ name: "binaryFnNumber::add" })).toBe(true);

      expect(isPipeDefWithSequence(null)).toBe(false);
      expect(isPipeDefWithSequence({})).toBe(false);
      expect(isPipeDefWithSequence({ sequence: {} })).toBe(false);
      expect(isPipeDefWithSequence({ sequence: [] })).toBe(true);

      expect(hasSymbolProperty(null)).toBe(false);
      expect(hasSymbolProperty({ symbol: "bogus" })).toBe(false);
      expect(hasSymbolProperty(numberValue(1))).toBe(true);

      expect(hasNameAndTransformFn(null)).toBe(false);
      expect(hasNameAndTransformFn({ name: 1, transformFn: [] })).toBe(false);
      expect(hasNameAndTransformFn({ name: "x" })).toBe(false);
      expect(hasNameAndTransformFn({ name: "x", transformFn: [] })).toBe(true);
    });

    it("covers context existence helpers for all backing tables", () => {
      const ctx = {
        ...emptyContext(),
        valueTable: { v1: numberValue(1) },
        funcTable: { f1: { kind: "cond", defId: "cd1", returnId: "v2" } },
        combineFuncDefTable: {
          pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
        },
        pipeFuncDefTable: { td1: { args: [], sequence: [] } },
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "v1" },
            trueBranchId: "f1",
            falseBranchId: "f1",
          },
        },
      } as any;

      expect(valueIdExistsInContext(1, ctx)).toBe(false);
      expect(valueIdExistsInContext("v1", ctx)).toBe(true);
      expect(valueIdExistsInContext("vReturn", ctx, new Set(["vReturn" as ValueId]))).toBe(true);
      expect(valueIdExistsInContext("missing", ctx)).toBe(false);
      expect(funcIdExistsInContext(1, ctx)).toBe(false);
      expect(funcIdExistsInContext("f1", ctx)).toBe(true);
      expect(funcIdExistsInContext("missing", ctx)).toBe(false);

      expect(defineIdExistsInContext(1, ctx)).toBe(false);
      expect(defineIdExistsInContext("pd1", ctx)).toBe(true);
      expect(defineIdExistsInContext("td1", ctx)).toBe(true);
      expect(defineIdExistsInContext("cd1", ctx)).toBe(true);
      expect(defineIdExistsInContext("missing", ctx)).toBe(false);

      expect(pipeStepDefIdExistsInContext(1, ctx)).toEqual({ exists: false, isCondDef: false });
      expect(pipeStepDefIdExistsInContext("pd1", ctx)).toEqual({ exists: true, isCondDef: false });
      expect(pipeStepDefIdExistsInContext("td1", ctx)).toEqual({ exists: true, isCondDef: false });
      expect(pipeStepDefIdExistsInContext("cd1", ctx)).toEqual({ exists: true, isCondDef: true });
      expect(pipeStepDefIdExistsInContext("missing", ctx)).toEqual({
        exists: false,
        isCondDef: false,
      });
    });

    it("covers type environment and function inference fallbacks", () => {
      const ctx = {
        ...emptyContext(),
        valueTable: { good: numberValue(1), bad: { symbol: "bogus" }, arr: [] },
        funcTable: {
          fCombine: { kind: "combine", defId: "pd1", argMap: {}, returnId: "v1" },
          fPipe: { kind: "pipe", defId: "td1", argMap: {}, returnId: "v2" },
          fPipeBadStep: { kind: "pipe", defId: "tdBad", argMap: {}, returnId: "v3" },
          fNoDef: { kind: "combine", returnId: "v4" },
        },
        combineFuncDefTable: {
          pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
        },
        pipeFuncDefTable: {
          td1: { args: [], sequence: [{ defId: "pd1", argBindings: {} }] },
          tdBad: { args: [], sequence: [{ defId: 42, argBindings: {} }] },
          tdEmpty: { args: [], sequence: [] },
        },
      } as any;

      const env = buildTypeEnvironment(ctx);
      expect(env.get("good" as any)).toBe("number");
      expect(env.has("bad" as any)).toBe(false);
      expect(inferFuncType("fCombine" as any, ctx)).toBe("number");
      expect(inferFuncType("fPipe" as any, ctx)).toBe("number");
      expect(inferFuncType("fPipeBadStep" as any, ctx)).toBeNull();
      expect(inferFuncType("missing" as any, ctx)).toBeNull();
      expect(inferFuncType("fNoDef" as any, ctx)).toBeNull();
      expect(
        inferFuncType(
          "cycle" as any,
          {
            ...ctx,
            funcTable: { cycle: { kind: "pipe", defId: "tdEmpty", argMap: {}, returnId: "v" } },
          } as any,
          new Set(["cycle" as any]),
        ),
      ).toBeNull();
    });
  });

  describe("executor defensive branches", () => {
    it("covers combine executor missing definition and argument/value failures", () => {
      const base = {
        ...emptyContext(),
        valueTable: { v1: numberValue(1) },
        funcTable: { f1: { kind: "combine", defId: "pd1", argMap: { a: "v1" }, returnId: "vOut" } },
      } as any;

      expect(() => executeCombineFunc("f1" as any, "pd1" as any, base)).toThrow(
        "missing combine definition",
      );
      expect(() => executeCombineFunc("missing" as any, "pd1" as any, base)).toThrow(
        "non-combine entry",
      );
      expect(() =>
        executeCombineFunc(
          "f1" as any,
          "pd1" as any,
          {
            ...base,
            combineFuncDefTable: {
              pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
            },
          } as any,
        ),
      ).toThrow("missing arg a/b");
      expect(() =>
        executeCombineFunc(
          "f1" as any,
          "pd1" as any,
          {
            ...base,
            funcTable: {
              f1: { kind: "combine", defId: "pd1", argMap: { a: "v1", b: "v2" }, returnId: "vOut" },
            },
            combineFuncDefTable: {
              pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
            },
          } as any,
        ),
      ).toThrow("missing value table entry");
    });

    it("covers cond and pipe executor defensive failures", () => {
      expect(() =>
        executeCondFunc("missing" as any, emptyContext(), numberValue(1) as any),
      ).toThrow("no funcTable entry");

      const condEntryContext = {
        ...emptyContext(),
        funcTable: { f1: { kind: "cond", defId: "cd1", returnId: "vOut" } },
      } as any;
      expect(() => executePipeFunc("f1" as any, "td1" as any, condEntryContext)).toThrow(
        "called with cond entry",
      );

      const pipeContext = {
        ...emptyContext(),
        valueTable: { v1: numberValue(1) },
        funcTable: { f1: { kind: "pipe", defId: "td1", argMap: { a: "v1" }, returnId: "vOut" } },
      } as any;
      expect(() => executePipeFunc("f1" as any, "td1" as any, pipeContext)).toThrow(
        "missing pipe definition",
      );
      expect(() =>
        executePipeFunc(
          "f1" as any,
          "td1" as any,
          { ...pipeContext, pipeFuncDefTable: { td1: { args: ["a"], sequence: [] } } } as any,
        ),
      ).toThrow("empty sequence");
    });

    it("covers record-style pipe args and extra value validation branches", () => {
      const argMap = { a: "v1" as ValueId } as FuncArgMap;
      const values = { v1: numberValue(1), extra: numberValue(2) } as any;
      expect(createScopedValueTable(argMap, { a: true }, values, ["extra" as ValueId])).toEqual(
        values,
      );
      expect(() =>
        validateScopedValueTable({ v1: values.v1 } as any, { a: true }, argMap, [
          "extra" as ValueId,
        ]),
      ).toThrow("missing extra");
      expect(() =>
        createScopedValueTable(argMap, { a: true }, { v1: values.v1 } as any, ["extra" as ValueId]),
      ).toThrow("Missing value: extra");
    });
  });
});
