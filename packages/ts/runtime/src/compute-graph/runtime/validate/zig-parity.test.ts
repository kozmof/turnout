import { describe, expect, it } from "vitest";
import { validateGraphContextWithZig } from "../../../zig-runtime/graph-validation.js";
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
  const zigResult = validateGraphContextWithZig(context);
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

  it("matches transform and combine type compatibility details", () => {
    expectParity({
      ...empty(),
      valueTable: {
        text: { symbol: "string", value: "x", subSymbol: undefined, tags: [] },
        number: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
      } as never,
      funcTable: {
        sum: {
          kind: "combine",
          defId: "add",
          argMap: { a: "text", b: "number" },
          returnId: "out",
        },
      } as never,
      combineFuncDefTable: {
        add: {
          name: "combineFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnString::pass"] },
        },
      },
    });
  });

  it("matches malformed function entry details", () => {
    const cases: UnvalidatedContext[] = [
      { ...empty(), funcTable: { bad: [] } as never },
      { ...empty(), funcTable: { bad: { kind: "unknown" } } as never },
      {
        ...empty(),
        funcTable: {
          bad: {
            kind: "combine",
            defId: "missing",
            argMap: { a: 42 },
            returnId: "out",
          },
        } as never,
      },
      {
        ...empty(),
        funcTable: { bad: { kind: "combine", defId: "add", returnId: "out" } } as never,
        combineFuncDefTable: {
          add: { name: "combineFnNumber::add", transformFn: { a: [], b: [] } },
        },
      },
      {
        ...empty(),
        funcTable: { bad: { kind: "cond", defId: "condition", argMap: 42 } } as never,
        condFuncDefTable: { condition: {} },
      },
    ];
    for (const context of cases) expectParity(context);
  });

  it("matches malformed combine definition details", () => {
    const cases: UnvalidatedContext[] = [
      { ...empty(), combineFuncDefTable: { bad: [] } },
      {
        ...empty(),
        combineFuncDefTable: { bad: { name: "combineFnNumber::add", transformFn: 42 } },
      },
      {
        ...empty(),
        combineFuncDefTable: {
          bad: { name: "combineFnNumber::add", transformFn: { a: [42], b: [] } },
        },
      },
    ];
    for (const context of cases) expectParity(context);
  });

  it("matches malformed pipe definition details", () => {
    const cases: UnvalidatedContext[] = [
      { ...empty(), pipeFuncDefTable: { bad: [] } },
      { ...empty(), pipeFuncDefTable: { bad: {} } },
      { ...empty(), pipeFuncDefTable: { bad: { sequence: [] } } },
      { ...empty(), pipeFuncDefTable: { bad: { args: 42, sequence: [42] } } },
      {
        ...empty(),
        pipeFuncDefTable: {
          bad: { sequence: [{ defId: "condition", argBindings: {} }] },
        },
        condFuncDefTable: { condition: {} },
      },
    ];
    for (const context of cases) expectParity(context);
  });

  it("matches malformed conditional definition details", () => {
    const cases: UnvalidatedContext[] = [
      { ...empty(), condFuncDefTable: { bad: [] } },
      { ...empty(), condFuncDefTable: { bad: {} } },
      {
        ...empty(),
        condFuncDefTable: {
          bad: {
            conditionId: { kind: "unknown", id: "condition" },
            trueBranchId: 1,
            falseBranchId: 2,
          },
        },
      },
    ];
    for (const context of cases) expectParity(context);
  });
});
