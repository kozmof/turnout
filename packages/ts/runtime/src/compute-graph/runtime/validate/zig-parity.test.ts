import { describe, expect, it } from "vitest";
import { validateLegacyContextWithZig } from "../../../zig-runtime/legacy-validation.js";
import { validateContext } from "./index.js";
import type { UnvalidatedContext } from "./types.js";

const empty = (): UnvalidatedContext => ({
  valueTable: {},
  funcTable: {},
  combineFuncDefTable: {},
  pipeFuncDefTable: {},
  condFuncDefTable: {},
});

function messages(result: ReturnType<typeof validateContext>) {
  return {
    valid: result.valid,
    errors: result.errors,
    warnings: result.warnings,
  };
}

function expectParity(context: UnvalidatedContext): void {
  const typescript = messages(validateContext(context));
  const zigResult = validateLegacyContextWithZig(context);
  expect({
    valid: zigResult.valid,
    errors: zigResult.errors,
    warnings: zigResult.warnings,
  }).toEqual(typescript);
}

describe("Zig legacy validation parity", () => {
  it("matches required tables and empty contexts", () => {
    expectParity({});
    expectParity(empty());
  });

  it("matches function, combine, and reference validation", () => {
    expectParity({
      ...empty(),
      valueTable: {
        left: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
        right: { symbol: "number", value: 2, subSymbol: undefined, tags: [] },
        unused: { symbol: "string", value: "x", subSymbol: undefined, tags: [] },
      } as never,
      funcTable: {
        sum: {
          kind: "combine",
          defId: "add",
          argMap: { a: "left", b: "right" },
          returnId: "out",
        },
      } as never,
      combineFuncDefTable: {
        add: {
          name: "combineFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
        },
        unusedDef: {
          name: "combineFnNumber::missing",
          transformFn: { a: ["transformFnNumber::missing"], b: [] },
        },
      },
    });
  });

  it("matches pipe binding and conditional validation", () => {
    expectParity({
      ...empty(),
      valueTable: {
        condition: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
      } as never,
      funcTable: {
        run: { kind: "pipe", defId: "pipe", argMap: {}, returnId: "pipeOut" },
        choose: { kind: "cond", defId: "choice", returnId: "choiceOut" },
      } as never,
      pipeFuncDefTable: {
        pipe: {
          args: ["input"],
          sequence: [
            {
              defId: "missing",
              argBindings: { a: { source: "input", argName: "unknown" } },
            },
          ],
        },
      },
      condFuncDefTable: {
        choice: {
          conditionId: { kind: "value", id: "condition" },
          trueBranchId: "missingTrue",
          falseBranchId: "missingFalse",
        },
      },
    });
  });

  it("matches deterministic pipe cycle reporting", () => {
    expectParity({
      ...empty(),
      pipeFuncDefTable: {
        first: {
          args: [],
          sequence: [{ defId: "second", argBindings: {} }],
        },
        second: {
          args: [],
          sequence: [{ defId: "first", argBindings: {} }],
        },
      },
    });
  });
});
