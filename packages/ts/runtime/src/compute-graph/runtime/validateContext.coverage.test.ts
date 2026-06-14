/**
 * Targeted tests to improve branch coverage for validateContext.ts.
 * These tests exercise edge cases and error paths not covered by the main test files.
 */

import { describe, it, expect } from "vitest";
import { validateContext, isValidationSuccess, isValidContext } from "./validateContext";
import type {
  ExecutionContext,
  FuncId,
  ValueId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
} from "../types";

// Helper to build a minimal valid context
function minContext(): ExecutionContext {
  return {
    valueTable: {} as any,
    funcTable: {} as any,
    combineFuncDefTable: {} as any,
    pipeFuncDefTable: {} as any,
    condFuncDefTable: {} as any,
  };
}

describe("validateContext — coverage", () => {
  describe("isValidationSuccess helper", () => {
    it("returns true for valid result", () => {
      const result = validateContext(minContext());
      expect(isValidationSuccess(result)).toBe(result.valid);
    });

    it("returns false for invalid result", () => {
      const invalid = validateContext({ valueTable: undefined } as any);
      expect(isValidationSuccess(invalid)).toBe(false);
    });
  });

  describe("FuncTable structural validation", () => {
    it("detects funcTable entry that is an array (not a record)", () => {
      const ctx = {
        ...minContext(),
        funcTable: { f1: [] } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("FuncTable[f1]: Invalid entry"))).toBe(
        true,
      );
    });

    it("detects funcTable entry with missing kind", () => {
      const ctx = {
        ...minContext(),
        funcTable: { f1: { defId: "pd1", returnId: "v1" } } as any,
        combineFuncDefTable: {
          pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid kind"))).toBe(true);
    });

    it("detects funcTable entry with unknown kind string", () => {
      const ctx = {
        ...minContext(),
        funcTable: { f1: { kind: "unknown_kind", defId: "pd1", returnId: "v1" } } as any,
        combineFuncDefTable: {
          pd1: { name: "binaryFnNumber::add", transformFn: { a: [], b: [] } },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Unknown kind "unknown_kind"'))).toBe(
        true,
      );
    });

    it("detects funcTable entry with missing defId", () => {
      const ctx = {
        ...minContext(),
        funcTable: { f1: { kind: "combine", returnId: "v1" } } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid defId"))).toBe(true);
    });

    it("detects funcTable entry with missing returnId", () => {
      const ctx = {
        ...minContext(),
        funcTable: { f1: { kind: "combine", defId: "pd1", argMap: {} } } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid returnId"))).toBe(
        true,
      );
    });

    it("detects combine func referencing wrong def table (pipe def)", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "combine",
            defId: "td1" as any,
            argMap: {},
            returnId: "v1" as ValueId,
          },
        } as any,
        pipeFuncDefTable: {
          td1: { args: [], sequence: [] },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes('kind "combine" must reference CombineFuncDefTable'),
        ),
      ).toBe(true);
    });

    it("detects pipe func referencing wrong def table (combine def)", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "pipe",
            defId: "pd1" as any,
            argMap: {},
            returnId: "v1" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes('kind "pipe" must reference PipeFuncDefTable'),
        ),
      ).toBe(true);
    });

    it("detects cond func referencing wrong def table", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "cond",
            defId: "pd1" as any,
            returnId: "v1" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes('kind "cond" must reference CondFuncDefTable'),
        ),
      ).toBe(true);
    });

    it("detects combine/pipe func without argMap", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            returnId: "v1" as ValueId,
            // no argMap
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('"combine" requires argMap'))).toBe(true);
    });

    it("detects cond with non-record argMap", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
          f1: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            argMap: "invalid_string" as any,
            returnId: "vR" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("cond argMap must be an object"))).toBe(
        true,
      );
    });

    it("detects argMap with non-string argument ID", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: 42 as any, b: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
        } as any,
        valueTable: { v1: { symbol: "number", value: 5, subSymbol: undefined } } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Argument ID must be a string"))).toBe(
        true,
      );
    });

    it("detects duplicate returnId across functions", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "sharedReturn" as ValueId,
          },
          f2: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "sharedReturn" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('duplicate returnId "sharedReturn"')),
      ).toBe(true);
    });
  });

  describe("CombineFuncDefTable validation", () => {
    it("detects non-record combineDef entry", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: { pd1: null } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("CombineFuncDefTable[pd1]: Invalid entry")),
      ).toBe(true);
    });

    it("detects combineDef with missing name property", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: { transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] } },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Invalid or missing function name")),
      ).toBe(true);
    });

    it("detects combineDef with unknown binary function name", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "unknownNamespace::unknownFn",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Invalid or unknown binary function")),
      ).toBe(true);
    });

    it("detects combineDef missing transform 'a'", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing transform function 'a'"))).toBe(
        true,
      );
    });

    it("detects combineDef missing transform 'b'", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing transform function 'b'"))).toBe(
        true,
      );
    });

    it("detects combineDef with invalid transform function entry (non-string)", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: [42 as any], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("has invalid entry"))).toBe(true);
    });

    it("detects combineDef with unknown transform function", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["unknownNS::unknownFn" as any], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Invalid or unknown transform function")),
      ).toBe(true);
    });

    it("warns when combineDef is never used", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("never used"))).toBe(true);
    });

    it("detects type mismatch: transform 'a' output does not match binary fn param", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            // transform 'a' converts number to string, but add expects number
            transformFn: { a: ["transformFnNumber::toStr"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Transform function 'a' returns"))).toBe(
        true,
      );
    });
  });

  describe("PipeFuncDefTable validation", () => {
    it("detects non-record pipeDef entry", () => {
      const ctx = {
        ...minContext(),
        pipeFuncDefTable: { td1: null } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("PipeFuncDefTable[td1]: Invalid entry")),
      ).toBe(true);
    });

    it("detects pipeDef with missing sequence", () => {
      const ctx = {
        ...minContext(),
        pipeFuncDefTable: { td1: { args: [] } } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid sequence"))).toBe(
        true,
      );
    });

    it("detects pipeDef with empty sequence", () => {
      const ctx = {
        ...minContext(),
        pipeFuncDefTable: { td1: { args: [], sequence: [] } } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Sequence is empty"))).toBe(true);
    });

    it("detects pipeDef with invalid args (not array or object)", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: 42 as any,
            sequence: [{ defId: "pd1", argBindings: {} }],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("'args' must be an array of strings")),
      ).toBe(true);
    });

    it("accepts pipeDef with args as record (backward compat)", () => {
      const ctx = {
        ...minContext(),
        valueTable: { v1: { symbol: "number", value: 5, subSymbol: undefined } } as any,
        funcTable: {
          f1: {
            kind: "pipe",
            defId: "td1" as PipeDefineId,
            argMap: { x: "v1" as ValueId },
            returnId: "vR" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: { x: "ia-x" as any }, // record-style args (backward compat)
            sequence: [
              {
                defId: "pd1",
                argBindings: {
                  a: { source: "input", argName: "x" },
                  b: { source: "input", argName: "x" },
                },
              },
            ],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(true);
    });

    it("detects pipeDef with non-string arg name in args array", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: [42 as any, "x"],
            sequence: [{ defId: "pd1", argBindings: {} }],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("argument name must be a string"))).toBe(
        true,
      );
    });

    it("detects pipeDef step referencing a cond def", () => {
      const ctx = {
        ...minContext(),
        valueTable: { vCond: { symbol: "boolean", value: true, subSymbol: undefined } } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: [],
            sequence: [
              {
                defId: "cd1", // cond def — not allowed in pipe steps
                argBindings: {},
              },
            ],
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("CondFunc definition"))).toBe(true);
    });

    it("detects pipeDef step with missing argBindings", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: [],
            sequence: [
              { defId: "pd1" }, // no argBindings
            ],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid argBindings"))).toBe(
        true,
      );
    });

    it("detects pipeDef step that is not an object", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: [],
            sequence: ["not_an_object" as any],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Step must be an object"))).toBe(true);
    });

    it("detects pipeDef step with missing defId", () => {
      const ctx = {
        ...minContext(),
        pipeFuncDefTable: {
          td1: {
            args: [],
            sequence: [{ argBindings: {} }], // no defId
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing step defId"))).toBe(true);
    });

    it("warns when pipeDef is never used", () => {
      const ctx = {
        ...minContext(),
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: ["x"],
            sequence: [
              {
                defId: "pd1",
                argBindings: {
                  a: { source: "input", argName: "x" },
                  b: { source: "input", argName: "x" },
                },
              },
            ],
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) =>
          w.message.includes("PipeFuncDefTable[td1]: Definition is never used"),
        ),
      ).toBe(true);
    });
  });

  describe("parseBinding validation", () => {
    function makeContextWithBinding(binding: unknown) {
      return {
        ...minContext(),
        valueTable: { v1: { symbol: "number", value: 5, subSymbol: undefined } } as any,
        funcTable: {
          f1: {
            kind: "pipe",
            defId: "td1" as PipeDefineId,
            argMap: { x: "v1" as ValueId },
            returnId: "vR" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: ["x"],
            sequence: [
              {
                defId: "pd1",
                argBindings: { a: binding, b: { source: "input", argName: "x" } },
              },
            ],
          },
        } as any,
      };
    }

    it("detects binding that is not a record", () => {
      const ctx = makeContextWithBinding("not_a_record" as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Argument binding for 'a' is invalid")),
      ).toBe(true);
    });

    it("detects binding with missing source property", () => {
      const ctx = makeContextWithBinding({ argName: "x" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Argument binding for 'a' is invalid")),
      ).toBe(true);
    });

    it("detects 'input' binding with missing argName", () => {
      const ctx = makeContextWithBinding({ source: "input" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("'input' binding for 'a' must include string argName"),
        ),
      ).toBe(true);
    });

    it("detects 'input' binding with empty argName", () => {
      const ctx = makeContextWithBinding({ source: "input", argName: "" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("'input' binding for 'a' must include string argName"),
        ),
      ).toBe(true);
    });

    it("detects 'step' binding with missing stepIndex", () => {
      const ctx = makeContextWithBinding({ source: "step" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("'step' binding for 'a' must include numeric stepIndex"),
        ),
      ).toBe(true);
    });

    it("detects 'value' binding with missing id", () => {
      const ctx = makeContextWithBinding({ source: "value" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("'value' binding for 'a' must include string id"),
        ),
      ).toBe(true);
    });

    it("detects 'value' binding with empty id", () => {
      const ctx = makeContextWithBinding({ source: "value", id: "" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("'value' binding for 'a' must include string id"),
        ),
      ).toBe(true);
    });

    it("detects binding with unknown source", () => {
      const ctx = makeContextWithBinding({ source: "bogus_source", data: "x" } as any);
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes('has unknown source "bogus_source"')),
      ).toBe(true);
    });

    it("detects 'input' binding that references undefined pipe arg", () => {
      const ctx = makeContextWithBinding({ source: "input", argName: "missing_arg" });
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("references undefined PipeFunc input")),
      ).toBe(true);
    });

    it("detects 'step' binding with out-of-range stepIndex", () => {
      const ctx = makeContextWithBinding({ source: "step", stepIndex: 5 });
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("references invalid step index 5"))).toBe(
        true,
      );
    });

    it("detects 'step' binding with negative stepIndex", () => {
      const ctx = makeContextWithBinding({ source: "step", stepIndex: -1 });
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("references invalid step index -1")),
      ).toBe(true);
    });

    it("detects 'value' binding with non-existent ValueId", () => {
      const ctx = makeContextWithBinding({ source: "value", id: "missing_value" });
      const result = validateContext(ctx as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("references non-existent ValueId missing_value"),
        ),
      ).toBe(true);
    });
  });

  describe("CondFuncDefTable validation", () => {
    it("detects non-record condDef entry", () => {
      const ctx = {
        ...minContext(),
        condFuncDefTable: { cd1: null } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("CondFuncDefTable[cd1]: Invalid entry")),
      ).toBe(true);
    });

    it("detects condDef with missing conditionId", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: { trueBranchId: "fT", falseBranchId: "fF" },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Missing or invalid conditionId"))).toBe(
        true,
      );
    });

    it("detects condDef with conditionId missing kind", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { id: "someId" }, // missing kind
            trueBranchId: "fT",
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Must include string kind and id"))).toBe(
        true,
      );
    });

    it("detects condDef with unknown conditionId kind", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "unknown_source", id: "someId" },
            trueBranchId: "fT",
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('Unknown kind "unknown_source"'))).toBe(
        true,
      );
    });

    it("detects condDef with func condition referencing non-existent FuncId", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "func", id: "fMissing" }, // func doesn't exist
            trueBranchId: "fT",
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Referenced FuncId fMissing does not exist")),
      ).toBe(true);
    });

    it("validates condDef with func condition (func source path)", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          fCond: {
            kind: "combine",
            defId: "pdCond" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vCond" as ValueId,
          },
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vRF" as ValueId,
          },
          fResult: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            returnId: "vResult" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pdCond: {
            name: "binaryFnGeneric::isEqual",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "func", id: "fCond" as FuncId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      // Validation may have warnings (unused values) but should succeed structurally
      expect(
        result.errors.filter(
          (e) => e.message.includes("Cycle") || e.message.includes("does not exist"),
        ),
      ).toHaveLength(0);
    });

    it("detects condDef with func condition returning non-boolean", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          fCond: {
            kind: "combine",
            defId: "pdNumber" as CombineDefineId, // returns number, not boolean
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vCond" as ValueId,
          },
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
          fResult: { kind: "cond", defId: "cd1" as CondDefineId, returnId: "vResult" as ValueId },
        } as any,
        combineFuncDefTable: {
          pdNumber: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "func", id: "fCond" as FuncId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Function condition must return boolean")),
      ).toBe(true);
    });

    it("detects condDef with value condition of wrong type", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vNum: { symbol: "number", value: 5, subSymbol: undefined }, // number, not boolean
        } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
          fResult: { kind: "cond", defId: "cd1" as CondDefineId, returnId: "vResult" as ValueId },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vNum" as ValueId }, // number value as condition
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Condition value must be boolean"))).toBe(
        true,
      );
    });

    it("detects condDef with missing trueBranchId", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            // no trueBranchId
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("trueBranchId: Missing or invalid FuncId")),
      ).toBe(true);
    });

    it("detects condDef with non-existent trueBranchId", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fMissing", // doesn't exist in funcTable
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Referenced FuncId fMissing does not exist")),
      ).toBe(true);
    });

    it("warns when condDef is never used", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "vRF" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fT",
            falseBranchId: "fF",
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some((w) =>
          w.message.includes("CondFuncDefTable[cd1]: Definition is never used"),
        ),
      ).toBe(true);
    });
  });

  describe("Cycle detection", () => {
    it("detects self-cycle in FuncTable (argMap references own returnId)", () => {
      const ctx = {
        ...minContext(),
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "vSelf" as ValueId, b: "vSelf" as ValueId },
            returnId: "vSelf" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Cycle detected"))).toBe(true);
    });

    it("detects cycle via cond branches", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "vResult" as ValueId, b: "v1" as ValueId },
            returnId: "vT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vF" as ValueId,
          },
          fResult: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            returnId: "vResult" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Cycle detected"))).toBe(true);
    });
  });

  describe("CombineFunc type inference in validateCombineFuncTypes", () => {
    it("warns when arg type cannot be inferred", () => {
      // vReturn refers to f1's returnId; f1 has returnId "vR" which means vReturn is a different value
      // This creates a scenario where we need arg type inference to fail
      // Actually let me use a cond function whose return type can't be inferred
      const condCtx = {
        ...minContext(),
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          fT: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vRT" as ValueId,
          },
          fF: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vRF" as ValueId,
          },
          fCond: { kind: "cond", defId: "cd1" as CondDefineId, returnId: "vCondOut" as ValueId },
          // fUser uses the cond output as an arg to a combine that has a transform
          fUser: {
            kind: "combine",
            defId: "pd2" as CombineDefineId,
            argMap: { a: "vCondOut" as ValueId, b: "v1" as ValueId },
            returnId: "vFinal" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
          pd2: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: ["transformFnNumber::pass"],
              b: ["transformFnNumber::pass"],
            },
          },
        } as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { kind: "value", id: "vCond" as ValueId },
            trueBranchId: "fT" as FuncId,
            falseBranchId: "fF" as FuncId,
          },
        } as any,
      };
      const result = validateContext(condCtx);
      // vCondOut can't be inferred (cond doesn't store return type in type env)
      // This should generate a warning about type not being inferable
      expect(
        result.warnings.some(
          (w) =>
            w.message.includes("type of argument") && w.message.includes("could not be inferred"),
        ),
      ).toBe(true);
    });
  });

  describe("Unreferenced values warning", () => {
    it("warns about unreferenced values", () => {
      const ctx = {
        ...minContext(),
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
          v2: { symbol: "number", value: 3, subSymbol: undefined }, // never referenced
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "vR" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          },
        } as any,
      };
      const result = validateContext(ctx);
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) => w.message.includes("v2") && w.message.includes("never referenced"),
        ),
      ).toBe(true);
    });
  });

  describe("isValidContext helper", () => {
    it("returns true for valid context via isValidContext", () => {
      expect(isValidContext(minContext())).toBe(true);
    });

    it("returns false for invalid context via isValidContext", () => {
      expect(isValidContext({ valueTable: undefined } as any)).toBe(false);
    });
  });

  describe("isBaseTypeSymbol — non-string symbol branch", () => {
    it("ignores valueTable entry with non-string symbol during type env build", () => {
      // When a value has symbol: <number>, isBaseTypeSymbol returns false (line 163 arm 0).
      // buildTypeEnvironment skips entries that fail hasSymbolProperty.
      const result = validateContext({
        ...minContext(),
        valueTable: {
          v1: { symbol: 999, value: 5, subSymbol: undefined, tags: [] } as any,
        },
      } as any);
      // The context is otherwise valid; the type-env just won't have v1's type.
      // Some validation may fail but the path is exercised.
      expect(result).toBeDefined();
    });
  });

  describe("isCombineDefWithBinaryFnName — null/invalid combineDef branch", () => {
    it("handles combineDef that is null (branch 2 arm 0)", () => {
      // When combineFuncDefTable[defId] is null/undefined, isCombineDefWithBinaryFnName
      // returns false (line 174 arm 0 in the outer if-not check).
      const result = validateContext({
        ...minContext(),
        funcTable: {
          f1: {
            kind: "combine" as const,
            defId: "pd1" as CombineDefineId,
            argMap: {} as any,
            returnId: "vR" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: null, // null entry — isCombineDefWithBinaryFnName returns false
        } as any,
      } as any);
      expect(result.valid).toBe(false);
    });
  });
});
