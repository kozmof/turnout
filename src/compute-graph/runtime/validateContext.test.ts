import { describe, it, expect } from "vitest";
import { validateContext, assertValidContext } from "./validateContext";
import {
  ExecutionContext,
  FuncId,
  ValueId,
  CombineDefineId,
  PipeDefineId,
  CondDefineId,
} from "../types";

describe("validateContext", () => {
  type MutableExecutionContext = {
    -readonly [K in keyof ExecutionContext]: ExecutionContext[K];
  };

  describe("valid contexts", () => {
    it("should validate a simple valid context with CombineFunc", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
          v2: { symbol: "number", value: 3, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
            returnId: "v3" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: {
              a: "ia1" as any,
              b: "ia2" as any,
            },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a context with PipeFunc", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 10, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
          pipe1: {
            kind: "pipe",
            defId: "td1" as PipeDefineId,
            argMap: { x: "v1" as ValueId },
            returnId: "v3" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {
          td1: {
            args: { x: "ia-x" as any },
            sequence: [
              {
                kind: "combine",
                defId: "pd1" as CombineDefineId,
                argBindings: {
                  a: { source: "input", argName: "x" },
                  b: { source: "input", argName: "x" },
                },
              },
            ],
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should validate a context with CondFunc", () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
          v1: { symbol: "number", value: 10, subSymbol: undefined },
        } as any,
        funcTable: {
          fTrue: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
          fFalse: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v3" as ValueId,
          },
          cond1: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            argMap: {},
            returnId: "v4" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { source: "value" as const, id: "vCond" as ValueId },
            trueBranchId: "fTrue" as FuncId,
            falseBranchId: "fFalse" as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("FuncTable validation errors", () => {
    it("should detect missing definition", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd-missing" as CombineDefineId,
            argMap: { a: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
        } as any,
        combineFuncDefTable: {} as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(
        result.errors.some((e) =>
          e.message.includes("Definition pd-missing does not exist"),
        ),
      ).toBe(true);
    });

    it("should detect invalid argument ID in argMap", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v-nonexistent" as ValueId },
            returnId: "v2" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((e) => e.message.includes("v-nonexistent")),
      ).toBe(true);
    });
  });

  describe("CombineFuncDefTable validation errors", () => {
    it("should detect missing function name", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {} as any,
        combineFuncDefTable: {
          pd1: {
            name: "" as any, // Invalid empty name
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Invalid or missing function name"),
        ),
      ).toBe(true);
    });

    it("should detect missing transform functions", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {} as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: undefined as any, // Missing transform functions
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Missing transform function"),
        ),
      ).toBe(true);
    });
  });

  describe("PipeFuncDefTable validation errors", () => {
    it("should detect empty sequence", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          pipe1: {
            kind: "pipe",
            defId: "td1" as PipeDefineId,
            argMap: {},
            returnId: "v1" as ValueId,
          },
        } as any,
        combineFuncDefTable: {} as any,
        pipeFuncDefTable: {
          td1: {
            args: {},
            sequence: [], // Empty sequence
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Sequence is empty")),
      ).toBe(true);
    });

    it("should detect invalid definition ID in sequence", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          pipe1: {
            kind: "pipe",
            defId: "td1" as PipeDefineId,
            argMap: {},
            returnId: "v1" as ValueId,
          },
        } as any,
        combineFuncDefTable: {} as any,
        pipeFuncDefTable: {
          td1: {
            args: {},
            sequence: [
              {
                kind: "combine",
                defId: "pd-nonexistent" as CombineDefineId,
                argBindings: {},
              },
            ],
          },
        } as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("pd-nonexistent")),
      ).toBe(true);
    });
  });

  describe("CondFuncDefTable validation errors", () => {
    it("should detect invalid condition ID", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          fTrue: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "v1" as ValueId,
          },
          fFalse: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "v2" as ValueId,
          },
          cond1: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            argMap: {},
            returnId: "v3" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: {
              source: "value" as const,
              id: "v-nonexistent" as ValueId,
            },
            trueBranchId: "fTrue" as FuncId,
            falseBranchId: "fFalse" as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("conditionId"))).toBe(
        true,
      );
    });

    it("should detect invalid trueBranchId", () => {
      const context: ExecutionContext = {
        valueTable: {
          vCond: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          fFalse: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: {},
            returnId: "v1" as ValueId,
          },
          cond1: {
            kind: "cond",
            defId: "cd1" as CondDefineId,
            argMap: {},
            returnId: "v2" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {
          cd1: {
            conditionId: { source: "value" as const, id: "vCond" as ValueId },
            trueBranchId: "f-nonexistent" as FuncId,
            falseBranchId: "fFalse" as FuncId,
          },
        } as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("trueBranchId")),
      ).toBe(true);
    });
  });

  describe("warnings", () => {
    it("should warn about unreferenced values", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
          v2: { symbol: "number", value: 10, subSymbol: undefined }, // Unreferenced
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v3" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("v2"))).toBe(true);
      expect(
        result.warnings.some((w) => w.message.includes("never referenced")),
      ).toBe(true);
    });

    it("should warn about unreferenced definitions", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
          "pd-unused": {
            // Unreferenced definition
            name: "binaryFnNumber::multiply",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      const result = validateContext(context);

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("pd-unused"))).toBe(
        true,
      );
      expect(
        result.warnings.some((w) => w.message.includes("never used")),
      ).toBe(true);
    });
  });

  describe("Type safety validation", () => {
    describe("CombineFuncDefTable type errors", () => {
      it("should detect invalid transform function name", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "number", value: 5, subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
              returnId: "v2" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::add",
              transformFn: {
                a: "invalidNamespace::unknown" as any,
                b: "transformFnNumber::pass",
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) =>
            e.message.includes("Invalid or unknown transform function"),
          ),
        ).toBe(true);
      });

      it("should detect transform function output type mismatch with binary function input", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "number", value: 5, subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
              returnId: "v2" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::add", // Expects number, number
              transformFn: {
                a: "transformFnNumber::toStr", // Returns string
                b: "transformFnNumber::pass", // Returns number
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) =>
              e.message.includes('returns "string" but binary function') &&
              e.message.includes('expects "number"'),
          ),
        ).toBe(true);
      });

      it("should validate correct transform and binary function types", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "number", value: 5, subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
              returnId: "v2" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnString::concat", // Expects string, string
              transformFn: {
                a: "transformFnNumber::toStr", // Returns string
                b: "transformFnNumber::toStr", // Returns string
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe("FuncTable argument type errors", () => {
      it("should detect argument type mismatch with transform function input", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "string", value: "hello", subSymbol: undefined },
            v2: { symbol: "number", value: 42, subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: {
                a: "v1" as ValueId, // string
                b: "v2" as ValueId, // number
              },
              returnId: "v3" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::add",
              transformFn: {
                a: "transformFnNumber::pass", // Expects number
                b: "transformFnNumber::pass", // Expects number
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) =>
              e.message.includes('has type "string"') &&
              e.message.includes('expects "number"'),
          ),
        ).toBe(true);
      });

      it("should validate correct argument types for transform functions", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "number", value: 10, subSymbol: undefined },
            v2: { symbol: "number", value: 5, subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: {
                a: "v1" as ValueId, // number
                b: "v2" as ValueId, // number
              },
              returnId: "v3" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::multiply",
              transformFn: {
                a: "transformFnNumber::pass", // Expects number
                b: "transformFnNumber::pass", // Expects number
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should handle random- prefixed value types correctly", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: {
              symbol: "number",
              value: 7,
              subSymbol: undefined,
              tags: ["random"],
            }, // number with random tag
            v2: { symbol: "number", value: 3, subSymbol: undefined, tags: [] }, // pure number
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: {
                a: "v1" as ValueId, // number with random tag (should be treated as number for type checking)
                b: "v2" as ValueId, // number
              },
              returnId: "v3" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::add",
              transformFn: {
                a: "transformFnNumber::pass", // Expects number
                b: "transformFnNumber::pass", // Expects number
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should detect type mismatch with string to number conversion", () => {
        const context: ExecutionContext = {
          valueTable: {
            v1: { symbol: "string", value: "123", subSymbol: undefined },
            v2: { symbol: "string", value: "456", subSymbol: undefined },
          } as any,
          funcTable: {
            f1: {
              kind: "combine",
              defId: "pd1" as CombineDefineId,
              argMap: {
                a: "v1" as ValueId, // string
                b: "v2" as ValueId, // string
              },
              returnId: "v3" as ValueId,
            },
          } as any,
          combineFuncDefTable: {
            pd1: {
              name: "binaryFnNumber::add", // Expects number, number
              transformFn: {
                a: "transformFnString::toNumber", // string -> number (correct)
                b: "transformFnString::toNumber", // string -> number (correct)
              },
              args: { a: "ia1" as any, b: "ia2" as any },
            },
          } as any,
          pipeFuncDefTable: {} as any,
          condFuncDefTable: {} as any,
        };

        const result = validateContext(context);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  describe("edge case regressions", () => {
    function createBaseContext(): MutableExecutionContext {
      return {
        valueTable: {
          v1: { symbol: "number", value: 1, subSymbol: undefined },
          v2: { symbol: "number", value: 2, subSymbol: undefined },
          vBool: { symbol: "boolean", value: true, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
            returnId: "v3" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };
    }

    it("rejects non-object required tables and does not crash", () => {
      const context = {
        valueTable: null,
        funcTable: {},
        combineFuncDefTable: {},
        pipeFuncDefTable: {},
        condFuncDefTable: {},
      } as unknown as ExecutionContext;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("valueTable must be an object"),
        ),
      ).toBe(true);
    });

    it("rejects FuncTable entry missing kind", () => {
      const context = createBaseContext();
      context.funcTable = {
        f1: {
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
          returnId: "v3" as ValueId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Missing or invalid kind"),
        ),
      ).toBe(true);
    });

    it("rejects unknown binary function names", () => {
      const context = createBaseContext();
      context.combineFuncDefTable = {
        pd1: {
          name: "binaryFnNumber::doesNotExist" as any,
          transformFn: {
            a: "transformFnNumber::pass",
            b: "transformFnNumber::pass",
          },
          args: { a: "ia1" as any, b: "ia2" as any },
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Invalid or unknown binary function"),
        ),
      ).toBe(true);
    });

    it("rejects non-object pipe steps", () => {
      const context = createBaseContext();
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "v1" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [42 as any],
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Step must be an object")),
      ).toBe(true);
    });

    it("rejects missing argBindings in pipe steps", () => {
      const context = createBaseContext();
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "v1" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [{ defId: "pd1" as CombineDefineId }],
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("Missing or invalid argBindings"),
        ),
      ).toBe(true);
    });

    it("handles unknown binding source without throwing", () => {
      const context = createBaseContext();
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "v1" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [
            {
              defId: "pd1" as CombineDefineId,
              argBindings: {
                a: { source: "mystery" as any },
                b: { source: "input", argName: "x" },
              },
            },
          ],
        },
      } as any;

      expect(() => validateContext(context)).not.toThrow();
      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("unknown source")),
      ).toBe(true);
    });

    it("rejects non-integer step binding indices", () => {
      const context = createBaseContext();
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "v1" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [
            {
              defId: "pd1" as CombineDefineId,
              argBindings: {
                a: { source: "input", argName: "x" },
                b: { source: "input", argName: "x" },
              },
            },
            {
              defId: "pd1" as CombineDefineId,
              argBindings: {
                a: { source: "step", stepIndex: 0.5 },
                b: { source: "input", argName: "x" },
              },
            },
          ],
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("invalid step index")),
      ).toBe(true);
    });

    it("requires CondFunc conditionId shape and valid source", () => {
      const context = createBaseContext();
      context.funcTable = {
        fTrue: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
          returnId: "vTrue" as ValueId,
        },
        fFalse: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v2" as ValueId, b: "v2" as ValueId },
          returnId: "vFalse" as ValueId,
        },
        cond1: {
          kind: "cond",
          defId: "cd1" as CondDefineId,
          returnId: "vResult" as ValueId,
        },
      } as any;
      context.condFuncDefTable = {
        cd1: {
          conditionId: { source: "unknown", id: "vBool" as ValueId } as any,
          trueBranchId: "fTrue" as FuncId,
          falseBranchId: "fFalse" as FuncId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("Unknown source")),
      ).toBe(true);
    });

    it("rejects non-boolean value-based Cond condition type", () => {
      const context = createBaseContext();
      context.funcTable = {
        fTrue: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
          returnId: "vTrue" as ValueId,
        },
        fFalse: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v2" as ValueId, b: "v2" as ValueId },
          returnId: "vFalse" as ValueId,
        },
        cond1: {
          kind: "cond",
          defId: "cd1" as CondDefineId,
          returnId: "vResult" as ValueId,
        },
      } as any;
      context.condFuncDefTable = {
        cd1: {
          conditionId: { source: "value", id: "v1" as ValueId },
          trueBranchId: "fTrue" as FuncId,
          falseBranchId: "fFalse" as FuncId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("must be boolean")),
      ).toBe(true);
    });

    it("rejects non-boolean func-based Cond condition type", () => {
      const context = createBaseContext();
      context.funcTable = {
        fCond: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
          returnId: "vCondOut" as ValueId,
        },
        fTrue: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
          returnId: "vTrue" as ValueId,
        },
        fFalse: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v2" as ValueId, b: "v2" as ValueId },
          returnId: "vFalse" as ValueId,
        },
        cond1: {
          kind: "cond",
          defId: "cd1" as CondDefineId,
          returnId: "vResult" as ValueId,
        },
      } as any;
      context.condFuncDefTable = {
        cd1: {
          conditionId: { source: "func", id: "fCond" as FuncId },
          trueBranchId: "fTrue" as FuncId,
          falseBranchId: "fFalse" as FuncId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("must return boolean")),
      ).toBe(true);
    });

    it("allows forward references to function return IDs in argMap", () => {
      const context = createBaseContext();
      context.funcTable = {
        consumer: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "vOut" as ValueId, b: "v1" as ValueId },
          returnId: "vResult" as ValueId,
        },
        producer: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "v1" as ValueId, b: "v2" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("marks value bindings as referenced to avoid false warnings", () => {
      const context = createBaseContext();
      context.valueTable = {
        vConst: { symbol: "number", value: 10, subSymbol: undefined },
        vInput: { symbol: "number", value: 1, subSymbol: undefined },
      } as any;
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "vInput" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [
            {
              defId: "pd1" as CombineDefineId,
              argBindings: {
                a: { source: "input", argName: "x" },
                b: { source: "value", id: "vConst" as ValueId },
              },
            },
          ],
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.message.includes("vConst"))).toBe(
        false,
      );
    });

    it("detects cycles in function dependencies", () => {
      const context = createBaseContext();
      context.funcTable = {
        f1: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "vF2" as ValueId, b: "v1" as ValueId },
          returnId: "vF1" as ValueId,
        },
        f2: {
          kind: "combine",
          defId: "pd1" as CombineDefineId,
          argMap: { a: "vF1" as ValueId, b: "v2" as ValueId },
          returnId: "vF2" as ValueId,
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("FuncTable: Cycle detected"),
        ),
      ).toBe(true);
    });

    it("detects cycles in pipe definition references", () => {
      const context = createBaseContext();
      context.funcTable = {
        pipe1: {
          kind: "pipe",
          defId: "td1" as PipeDefineId,
          argMap: { x: "v1" as ValueId },
          returnId: "vOut" as ValueId,
        },
      } as any;
      context.pipeFuncDefTable = {
        td1: {
          args: { x: "ia-x" as any },
          sequence: [
            {
              defId: "td2" as PipeDefineId,
              argBindings: { x: { source: "input", argName: "x" } },
            },
          ],
        },
        td2: {
          args: { x: "ia-x" as any },
          sequence: [
            {
              defId: "td1" as PipeDefineId,
              argBindings: { x: { source: "input", argName: "x" } },
            },
          ],
        },
      } as any;

      const result = validateContext(context);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) =>
          e.message.includes("PipeFuncDefTable: Cycle detected"),
        ),
      ).toBe(true);
    });
  });

  describe("assertValidContext", () => {
    it("should not throw for valid context", () => {
      const context: ExecutionContext = {
        valueTable: {
          v1: { symbol: "number", value: 5, subSymbol: undefined },
        } as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd1" as CombineDefineId,
            argMap: { a: "v1" as ValueId, b: "v1" as ValueId },
            returnId: "v2" as ValueId,
          },
        } as any,
        combineFuncDefTable: {
          pd1: {
            name: "binaryFnNumber::add",
            transformFn: {
              a: "transformFnNumber::pass",
              b: "transformFnNumber::pass",
            },
            args: { a: "ia1" as any, b: "ia2" as any },
          },
        } as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      expect(() => assertValidContext(context)).not.toThrow();
    });

    it("should throw for invalid context", () => {
      const context: ExecutionContext = {
        valueTable: {} as any,
        funcTable: {
          f1: {
            kind: "combine",
            defId: "pd-missing" as CombineDefineId,
            argMap: {},
            returnId: "v1" as ValueId,
          },
        } as any,
        combineFuncDefTable: {} as any,
        pipeFuncDefTable: {} as any,
        condFuncDefTable: {} as any,
      };

      expect(() => assertValidContext(context)).toThrow(
        "ExecutionContext validation failed",
      );
    });
  });
});
