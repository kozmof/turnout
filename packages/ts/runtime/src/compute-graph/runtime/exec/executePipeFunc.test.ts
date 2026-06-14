import { describe, it, expect } from "vitest";
import {
  createScopedValueTable,
  createScopedContext,
  validateScopedValueTable,
  executePipeFunc,
} from "./executePipeFunc";
import {
  ExecutionContext,
  FuncId,
  FuncArgMap,
  ValueId,
  ValueTable,
  PipeDefineId,
  CombineDefineId,
} from "../../types";

describe("executePipeFunc helpers", () => {
  describe("createScopedValueTable", () => {
    it("should create a scoped value table with all required arguments", () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        v2: { symbol: "string", value: "hello", subSymbol: undefined, tags: [] },
        v3: { symbol: "boolean", value: true, subSymbol: undefined, tags: [] },
      } as any;

      const argMap = {
        a: "v1" as ValueId,
        b: "v2" as ValueId,
      } as FuncArgMap;

      const pipeDefArgs = ["a", "b"];

      const result = createScopedValueTable(argMap, pipeDefArgs, sourceValueTable);

      expect(result).toEqual({
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        v2: { symbol: "string", value: "hello", subSymbol: undefined, tags: [] },
      });

      // Should NOT include v3 (not in argMap)
      expect("v3" in result).toBe(false);
    });

    it("should throw error when argument is missing from argMap", () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
      } as any;

      const argMap = {
        // Missing 'b'
        a: "v1" as ValueId,
      } as FuncArgMap;

      const pipeDefArgs = ["a", "b"]; // 'b' expected but missing from argMap

      expect(() => createScopedValueTable(argMap, pipeDefArgs, sourceValueTable)).toThrow();
    });

    it("should throw error when value is missing from sourceValueTable", () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        // v2 is missing
      } as any;

      const argMap = {
        a: "v1" as ValueId,
        b: "v2" as ValueId,
      };

      const pipeDefArgs = ["a", "b"];

      expect(() => createScopedValueTable(argMap, pipeDefArgs, sourceValueTable)).toThrow(
        "Missing value: v2",
      );
    });

    it("should handle empty pipeDefArgs (no arguments)", () => {
      const sourceValueTable: ValueTable = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
      } as any;

      const argMap = {} as FuncArgMap;
      const pipeDefArgs: string[] = [];

      const result = createScopedValueTable(argMap, pipeDefArgs, sourceValueTable);

      expect(result).toEqual({});
    });
  });

  describe("validateScopedValueTable", () => {
    it("should pass validation when all expected values are present", () => {
      const scopedValueTable: Partial<ValueTable> = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        v2: { symbol: "string", value: "hello", subSymbol: undefined, tags: [] },
      } as any;

      const argMap = {
        a: "v1" as ValueId,
        b: "v2" as ValueId,
      };

      const pipeDefArgs = ["a", "b"];

      expect(() => validateScopedValueTable(scopedValueTable, pipeDefArgs, argMap)).not.toThrow();
    });

    it("should throw error when expected value is missing", () => {
      const scopedValueTable: Partial<ValueTable> = {
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        // v2 is missing
      } as any;

      const argMap = {
        a: "v1" as ValueId,
        b: "v2" as ValueId,
      } as FuncArgMap;

      const pipeDefArgs = ["a", "b"];

      expect(() => validateScopedValueTable(scopedValueTable, pipeDefArgs, argMap)).toThrow(
        "Scoped value table is incomplete: missing v2",
      );
    });

    it("should pass validation for empty table with no arguments", () => {
      const scopedValueTable: Partial<ValueTable> = {};
      const argMap = {} as FuncArgMap;
      const pipeDefArgs: string[] = [];

      expect(() => validateScopedValueTable(scopedValueTable, pipeDefArgs, argMap)).not.toThrow();
    });
  });

  describe("createScopedContext", () => {
    it("should create a new context with scoped value table", () => {
      const originalContext: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
          v2: { symbol: "string", value: "original", subSymbol: undefined, tags: [] },
        } as any,
        funcTable: {} as any,
        combineFuncDefTable: {} as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const scopedValueTable: ValueTable = {
        v3: { symbol: "number", value: 20, subSymbol: undefined, tags: [] },
      } as any;

      const scopedContext = createScopedContext(originalContext, scopedValueTable);

      // Should have the new scoped value table
      expect(scopedContext.valueTable).toBe(scopedValueTable);
      expect(scopedContext.valueTable).toEqual({
        v3: { symbol: "number", value: 20, subSymbol: undefined, tags: [] },
      });

      // Should preserve other tables from original context
      expect(scopedContext.funcTable).toBe(originalContext.funcTable);
      expect(scopedContext.combineFuncDefTable).toBe(originalContext.combineFuncDefTable);
      expect(scopedContext.pipeFuncDefTable).toBe(originalContext.pipeFuncDefTable);
      expect(scopedContext.condFuncDefTable).toBe(originalContext.condFuncDefTable);
      expect(scopedContext.scope).toBe("pipe");
      expect(scopedContext.visibleValueIds.has("v3" as ValueId)).toBe(true);

      // Original context should not be mutated
      expect(originalContext.valueTable).toEqual({
        v1: { symbol: "number", value: 10, subSymbol: undefined, tags: [] },
        v2: { symbol: "string", value: "original", subSymbol: undefined, tags: [] },
      });
    });
  });
});

describe("executePipeFunc", () => {
  function baseContext(): ExecutionContext {
    return {
      valueTable: {
        v1: { symbol: "number", value: 2, subSymbol: undefined, tags: [] },
        v2: { symbol: "number", value: 3, subSymbol: undefined, tags: [] },
      } as any,
      funcTable: {
        pipe1: {
          kind: "pipe",
          defId: "td_outer" as PipeDefineId,
          argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
          returnId: "v_result" as ValueId,
        },
      } as any,
      combineFuncDefTable: {
        pd_add: {
          name: "binaryFnNumber::add",
          transformFn: {
            a: ["transformFnNumber::pass"],
            b: ["transformFnNumber::pass"],
          },
          args: { a: "ia1" as any, b: "ia2" as any },
        },
      } as any,
      pipeFuncDefTable: {
        td_outer: {
          args: { a: "ia-a", b: "ia-b" },
          sequence: [
            {
              kind: "combine",
              defId: "pd_add" as CombineDefineId,
              argBindings: {
                a: { source: "input", argName: "a" },
                b: { source: "input", argName: "b" },
              },
            },
          ],
        },
      } as any,
      condFuncDefTable: {} as any,
    };
  }

  it("executes a pipe definition with object args", () => {
    const context = baseContext();

    const result = executePipeFunc("pipe1" as FuncId, "td_outer" as PipeDefineId, context);

    expect(result.value.value).toBe(5);
    expect(result.updatedValueTable["v_result" as ValueId]?.value).toBe(5);
  });

  it("executes a pipe step with a direct value binding outside pipe inputs", () => {
    const context = baseContext();
    (context as { valueTable: typeof context.valueTable }).valueTable = {
      ...context.valueTable,
      v_const: { symbol: "number", value: 4, subSymbol: undefined, tags: [] },
    } as any;
    (context.funcTable as Record<string, unknown>)["pipe1" as FuncId] = {
      kind: "pipe",
      defId: "td_outer" as PipeDefineId,
      argMap: { a: "v1" as ValueId },
      returnId: "v_result" as ValueId,
    };
    (context.pipeFuncDefTable as Record<string, unknown>)["td_outer" as PipeDefineId] = {
      args: { a: "ia-a" },
      sequence: [
        {
          kind: "combine",
          defId: "pd_add" as CombineDefineId,
          argBindings: {
            a: { source: "input", argName: "a" },
            b: { source: "value", id: "v_const" as ValueId },
          },
        },
      ],
    };

    const result = executePipeFunc("pipe1" as FuncId, "td_outer" as PipeDefineId, context);

    expect(result.value.value).toBe(6);
  });

  it("executes a nested pipe step recursively", () => {
    const context = baseContext();
    (context as { pipeFuncDefTable: typeof context.pipeFuncDefTable }).pipeFuncDefTable = {
      ...context.pipeFuncDefTable,
      td_inner: {
        args: { x: "ia-x", y: "ia-y" },
        sequence: [
          {
            kind: "combine",
            defId: "pd_add" as CombineDefineId,
            argBindings: {
              a: { source: "input", argName: "x" },
              b: { source: "input", argName: "y" },
            },
          },
        ],
      },
      td_outer: {
        args: { a: "ia-a", b: "ia-b" },
        sequence: [
          {
            kind: "pipe",
            defId: "td_inner" as PipeDefineId,
            argBindings: {
              x: { source: "input", argName: "a" },
              y: { source: "input", argName: "b" },
            },
          },
          {
            kind: "combine",
            defId: "pd_add" as CombineDefineId,
            argBindings: {
              a: { source: "step", stepIndex: 0 },
              b: { source: "value", id: "v2" as ValueId },
            },
          },
        ],
      },
    } as any;

    const result = executePipeFunc("pipe1" as FuncId, "td_outer" as PipeDefineId, context);

    expect(result.value.value).toBe(8);
  });

  it("rejects cond function entries and invalid step references", () => {
    const context = baseContext();
    (context.funcTable as Record<string, unknown>)["cond1" as FuncId] = {
      kind: "cond",
      defId: "cd1" as any,
      conditionId: { kind: "value", id: "v1" as ValueId },
      trueBranchId: "f_true" as FuncId,
      falseBranchId: "f_false" as FuncId,
      returnId: "v_cond" as ValueId,
    } as any;

    expect(() => executePipeFunc("cond1" as FuncId, "td_outer" as PipeDefineId, context)).toThrow(
      "cond entry",
    );

    (context.pipeFuncDefTable as Record<string, unknown>)["td_outer" as PipeDefineId] = {
      args: { a: "ia-a", b: "ia-b" },
      sequence: [
        {
          kind: "combine",
          defId: "pd_add" as CombineDefineId,
          argBindings: {
            a: { source: "step", stepIndex: 0 },
            b: { source: "input", argName: "b" },
          },
        },
      ],
    } as any;

    expect(() => executePipeFunc("pipe1" as FuncId, "td_outer" as PipeDefineId, context)).toThrow(
      "Invalid step reference",
    );
  });
});
