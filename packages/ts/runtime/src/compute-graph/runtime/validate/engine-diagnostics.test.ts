/**
 * The diagnostics `graph_validate.zig` returns, read through `validateContext`.
 *
 * This file used to be `zig-parity.test.ts`, and it compared `validateContext`
 * against `validateGraphContextWithZig`. That made sense while a TypeScript
 * validator existed to compare against. It does not now: `validate/index.ts`
 * *is* a call to `validateGraphContextWithZig`, so both sides of the comparison
 * were the same call and the only thing the file could still catch was the
 * engine returning a non-empty `errors` array alongside `valid: true`.
 *
 * The contexts were worth keeping — twenty-four of them, covering malformed
 * entries in every table, pipe cycles, and transform/combine type mismatches —
 * so they are asserted against the messages the engine actually produces. A
 * reworded diagnostic now fails here, which is the point: the message text is
 * what a caller of the builder API reads, and nothing else pins it.
 *
 * Messages are asserted in full and in order. `details` is spot-checked where
 * its shape is the interesting part; asserting every field of every diagnostic
 * would pin the engine's internals rather than its output.
 */
import { describe, expect, it } from "vitest";
import { validateContext } from "./index.js";
import type { UnvalidatedContext } from "./types.js";

const empty = (): UnvalidatedContext => ({
  valueTable: {},
  funcTable: {},
  combineFuncDefTable: {},
  pipeFuncDefTable: {},
  condFuncDefTable: {},
});

type Diagnostics = {
  valid: boolean;
  errors: readonly string[];
  warnings: readonly string[];
};

/** `valid` plus the message text of every diagnostic, in the order reported. */
function diagnose(context: UnvalidatedContext): Diagnostics {
  const result = validateContext(context);
  return {
    valid: result.valid,
    errors: result.errors.map((error) => error.message),
    warnings: result.warnings.map((warning) => warning.message),
  };
}

function expectValid(context: UnvalidatedContext): void {
  expect(diagnose(context)).toEqual({ valid: true, errors: [], warnings: [] });
}

describe("required tables", () => {
  it("names every missing table", () => {
    expect(diagnose({})).toEqual({
      valid: false,
      errors: [
        "ExecutionContext is missing required table: valueTable",
        "ExecutionContext is missing required table: funcTable",
        "ExecutionContext is missing required table: combineFuncDefTable",
        "ExecutionContext is missing required table: pipeFuncDefTable",
        "ExecutionContext is missing required table: condFuncDefTable",
      ],
      warnings: [],
    });
  });

  it("carries the table name in details", () => {
    const result = validateContext({});
    expect(result.errors[0]?.details).toEqual({ tableName: "valueTable" });
  });

  it("accepts a context whose tables are all present and empty", () => {
    expectValid(empty());
  });
});

describe("combine definitions and references", () => {
  it("reports unknown functions and warns about what nothing reaches", () => {
    expect(
      diagnose({
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
      }),
    ).toEqual({
      valid: false,
      errors: [
        'CombineFuncDefTable[unusedDef]: Invalid or unknown combine function "combineFnNumber::missing"',
        'CombineFuncDefTable[unusedDef].transformFn.a: Invalid or unknown transform function "transformFnNumber::missing"',
      ],
      warnings: [
        "CombineFuncDefTable[unusedDef]: Definition is never used",
        "ValueTable[unused]: Value is never referenced",
      ],
    });
  });

  it("reports malformed definitions", () => {
    expect(diagnose({ ...empty(), combineFuncDefTable: { bad: [] } }).errors).toEqual([
      "CombineFuncDefTable[bad]: Invalid entry",
    ]);
    expect(
      diagnose({
        ...empty(),
        combineFuncDefTable: { bad: { name: "combineFnNumber::add", transformFn: 42 } },
      }).errors,
    ).toEqual(["CombineFuncDefTable[bad]: Missing transform function definitions"]);
    expect(
      diagnose({
        ...empty(),
        combineFuncDefTable: {
          bad: { name: "combineFnNumber::add", transformFn: { a: [42], b: [] } },
        },
      }),
    ).toEqual({
      valid: false,
      errors: ["CombineFuncDefTable[bad]: Transform function 'a' has invalid entry"],
      warnings: ["CombineFuncDefTable[bad]: Definition is never used"],
    });
  });
});

describe("pipe and conditional definitions", () => {
  it("reports a missing step definition and an ill-typed condition together", () => {
    expect(
      diagnose({
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
              { defId: "missing", argBindings: { a: { source: "input", argName: "unknown" } } },
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
      }),
    ).toEqual({
      valid: false,
      errors: [
        "PipeFuncDefTable[pipe].sequence[0]: Referenced definition missing does not exist",
        'CondFuncDefTable[choice].conditionId: Condition value must be boolean, got "number"',
        "CondFuncDefTable[choice].trueBranchId: Referenced FuncId missingTrue does not exist",
        "CondFuncDefTable[choice].falseBranchId: Referenced FuncId missingFalse does not exist",
      ],
      warnings: [],
    });
  });

  it("reports a pipe cycle by its path, deterministically", () => {
    const context: UnvalidatedContext = {
      ...empty(),
      pipeFuncDefTable: {
        first: { args: [], sequence: [{ defId: "second", argBindings: {} }] },
        second: { args: [], sequence: [{ defId: "first", argBindings: {} }] },
      },
    };
    expect(diagnose(context)).toEqual({
      valid: false,
      errors: ["PipeFuncDefTable: Cycle detected first -> second -> first"],
      warnings: [
        "PipeFuncDefTable[first]: Definition is never used",
        "PipeFuncDefTable[second]: Definition is never used",
      ],
    });
    // The path, not just the message: a set-based walk would report either
    // rotation of the same cycle and both would read correctly.
    expect(validateContext(context).errors[0]?.details).toEqual({
      cycle: ["first", "second", "first"],
    });
  });

  it("reports malformed pipe definitions", () => {
    expect(diagnose({ ...empty(), pipeFuncDefTable: { bad: [] } }).errors).toEqual([
      "PipeFuncDefTable[bad]: Invalid entry",
    ]);
    expect(diagnose({ ...empty(), pipeFuncDefTable: { bad: {} } }).errors).toEqual([
      "PipeFuncDefTable[bad]: Missing or invalid sequence",
    ]);
    expect(diagnose({ ...empty(), pipeFuncDefTable: { bad: { sequence: [] } } }).errors).toEqual([
      "PipeFuncDefTable[bad]: Sequence is empty",
    ]);
    expect(
      diagnose({ ...empty(), pipeFuncDefTable: { bad: { args: 42, sequence: [42] } } }).errors,
    ).toEqual([
      "PipeFuncDefTable[bad]: 'args' must be an array of strings",
      "PipeFuncDefTable[bad].sequence[0]: Step must be an object",
    ]);
  });

  it("rejects a conditional definition used as a pipe step", () => {
    expect(
      diagnose({
        ...empty(),
        pipeFuncDefTable: { bad: { sequence: [{ defId: "condition", argBindings: {} }] } },
        condFuncDefTable: { condition: {} },
      }),
    ).toEqual({
      valid: false,
      errors: [
        "PipeFuncDefTable[bad].sequence[0]: CondFunc definition condition cannot be used as a pipe step; only combine and pipe definitions are supported",
        "CondFuncDefTable[condition]: Missing or invalid conditionId",
        "CondFuncDefTable[condition].trueBranchId: Missing or invalid FuncId",
        "CondFuncDefTable[condition].falseBranchId: Missing or invalid FuncId",
      ],
      warnings: [
        "PipeFuncDefTable[bad]: Definition is never used",
        "CondFuncDefTable[condition]: Definition is never used",
      ],
    });
  });

  it("reports malformed conditional definitions", () => {
    expect(diagnose({ ...empty(), condFuncDefTable: { bad: [] } }).errors).toEqual([
      "CondFuncDefTable[bad]: Invalid entry",
    ]);
    expect(diagnose({ ...empty(), condFuncDefTable: { bad: {} } }).errors).toEqual([
      "CondFuncDefTable[bad]: Missing or invalid conditionId",
      "CondFuncDefTable[bad].trueBranchId: Missing or invalid FuncId",
      "CondFuncDefTable[bad].falseBranchId: Missing or invalid FuncId",
    ]);
    expect(
      diagnose({
        ...empty(),
        condFuncDefTable: {
          bad: {
            conditionId: { kind: "unknown", id: "condition" },
            trueBranchId: 1,
            falseBranchId: 2,
          },
        },
      }).errors,
    ).toEqual([
      'CondFuncDefTable[bad].conditionId: Unknown kind "unknown"',
      "CondFuncDefTable[bad].trueBranchId: Missing or invalid FuncId",
      "CondFuncDefTable[bad].falseBranchId: Missing or invalid FuncId",
    ]);
  });
});

describe("type compatibility", () => {
  it("reports the argument, the transform, and the combine separately", () => {
    expect(
      diagnose({
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
      }),
    ).toEqual({
      valid: false,
      errors: [
        `FuncTable[sum].argMap['a']: Argument has type "string" but transform function "transformFnNumber::pass" expects "number"`,
        `FuncTable[sum].argMap['b']: Argument has type "number" but transform function "transformFnString::pass" expects "string"`,
        `FuncTable[sum].argMap['b']: Argument resolves to type "string" but combine function "combineFnNumber::add" expects "number"`,
        `CombineFuncDefTable[add]: Transform function 'b' returns "string" but combine function "combineFnNumber::add" expects "number" for second parameter`,
      ],
      warnings: [],
    });
  });
});

describe("malformed function entries", () => {
  it("reports an entry that is not an object", () => {
    expect(diagnose({ ...empty(), funcTable: { bad: [] } as never }).errors).toEqual([
      "FuncTable[bad]: Invalid entry",
    ]);
  });

  it("reports an unknown kind", () => {
    expect(
      diagnose({ ...empty(), funcTable: { bad: { kind: "unknown" } } as never }).errors,
    ).toEqual(['FuncTable[bad]: Unknown kind "unknown"']);
  });

  it("reports a missing definition, a non-string arg id, and a missing argument together", () => {
    expect(
      diagnose({
        ...empty(),
        funcTable: {
          bad: { kind: "combine", defId: "missing", argMap: { a: 42 }, returnId: "out" },
        } as never,
      }).errors,
    ).toEqual([
      "FuncTable[bad]: Definition missing does not exist",
      'FuncTable[bad]: kind "combine" must reference CombineFuncDefTable, got missing',
      "FuncTable[bad].argMap['a']: Argument ID must be a string",
      'FuncTable[bad].argMap: Combine function requires argument "b"',
    ]);
  });

  it("reports a combine entry with no argMap", () => {
    expect(
      diagnose({
        ...empty(),
        funcTable: { bad: { kind: "combine", defId: "add", returnId: "out" } } as never,
        combineFuncDefTable: {
          add: { name: "combineFnNumber::add", transformFn: { a: [], b: [] } },
        },
      }).errors,
    ).toEqual(['FuncTable[bad]: kind "combine" requires argMap']);
  });

  it("reports a cond entry with a non-object argMap and no returnId", () => {
    expect(
      diagnose({
        ...empty(),
        funcTable: { bad: { kind: "cond", defId: "condition", argMap: 42 } } as never,
        condFuncDefTable: { condition: {} },
      }).errors,
    ).toEqual([
      "FuncTable[bad]: Missing or invalid returnId",
      "FuncTable[bad]: cond argMap must be an object when provided",
      "CondFuncDefTable[condition]: Missing or invalid conditionId",
      "CondFuncDefTable[condition].trueBranchId: Missing or invalid FuncId",
      "CondFuncDefTable[condition].falseBranchId: Missing or invalid FuncId",
    ]);
  });
});
