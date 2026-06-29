import { describe, it, expect } from "vitest";
import { validateContext } from "./validateContext.js";
import { buildExecutionTree } from "./buildExecutionTree.js";
import { executeTree } from "./executeTree.js";
import { MAX_GRAPH_NODES } from "./limits.js";
import type { ExecutionContext, FuncId } from "../types.js";

// These tests guard against unbounded compute-graph complexity: the validator
// must reject oversized models with a clear error (not a RangeError), and the
// build/execute/validation traversals must handle dependency chains far deeper
// than the native call stack would allow under recursion.

const num = (value: number) => ({ symbol: "number", value, subSymbol: undefined, tags: [] });

// A chain depth comfortably past the point where recursive traversal overflows
// the V8 call stack, while staying under MAX_GRAPH_NODES so the budget check
// does not short-circuit the traversal under test.
const DEEP = 40_000;

describe("compute-graph complexity limits", () => {
  it("rejects models exceeding the node budget instead of overflowing", () => {
    const valueTable: Record<string, ReturnType<typeof num>> = {};
    for (let i = 0; i <= MAX_GRAPH_NODES; i += 1) {
      valueTable[`v${i}`] = num(i);
    }

    const context = {
      valueTable,
      funcTable: {},
      combineFuncDefTable: {},
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as unknown as ExecutionContext;

    let result: ReturnType<typeof validateContext>;
    expect(() => {
      result = validateContext(context);
    }).not.toThrow();

    expect(result!.valid).toBe(false);
    expect(result!.errors.some((e) => e.message.includes("too large"))).toBe(true);
  });

  it("validates a deep dependency chain without a stack overflow", () => {
    // f0 consumes the base value; each subsequent function consumes the prior
    // function's return value, forming a single chain DEEP links long.
    const funcTable: Record<string, unknown> = {};
    for (let i = 0; i < DEEP; i += 1) {
      const argA = i === 0 ? "v0" : `r${i - 1}`;
      funcTable[`f${i}`] = {
        kind: "combine",
        defId: "add",
        argMap: { a: argA, b: "vc" },
        returnId: `r${i}`,
      };
    }

    const context = {
      valueTable: { v0: num(0), vc: num(1) },
      funcTable,
      combineFuncDefTable: {
        add: {
          name: "binaryFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          args: { a: "ia1", b: "ia2" },
        },
      },
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as unknown as ExecutionContext;

    // The cycle-detection pass walks the chain to its full depth; the iterative
    // traversal must complete rather than throw "Maximum call stack size".
    expect(() => validateContext(context)).not.toThrow();
  });

  it("builds an execution tree for a deep chain without a stack overflow", () => {
    const funcTable: Record<string, unknown> = {};
    for (let i = 0; i < DEEP; i += 1) {
      const argA = i === 0 ? "v0" : `r${i - 1}`;
      funcTable[`f${i}`] = {
        kind: "combine",
        defId: "add",
        argMap: { a: argA, b: "vc" },
        returnId: `r${i}`,
      };
    }

    const context = {
      valueTable: { v0: num(0), vc: num(1) },
      funcTable,
      combineFuncDefTable: {
        add: {
          name: "binaryFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          args: { a: "ia1", b: "ia2" },
        },
      },
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as unknown as ExecutionContext;

    let tree: ReturnType<typeof buildExecutionTree>;
    expect(() => {
      tree = buildExecutionTree(`f${DEEP - 1}` as FuncId, context);
    }).not.toThrow();
    expect(tree!.nodeType).toBe("function");
  });

  it("executes a deeply nested tree without a stack overflow", () => {
    // Every function node reuses the same return id ("vr") so the value table
    // stays a constant size — this keeps the test O(depth), not O(depth^2),
    // while still forcing the executor to descend DEEP levels.
    const context = {
      valueTable: { v0: num(0), vc: num(1), vr: num(0) },
      funcTable: {
        fBase: { kind: "combine", defId: "add", argMap: { a: "v0", b: "vc" }, returnId: "vr" },
        fInner: { kind: "combine", defId: "add", argMap: { a: "vr", b: "vc" }, returnId: "vr" },
      },
      combineFuncDefTable: {
        add: {
          name: "binaryFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          args: { a: "ia1", b: "ia2" },
        },
      },
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as unknown as ExecutionContext;

    const vc = { nodeType: "value", nodeId: "vc", value: num(1) };
    let tree: unknown = {
      nodeType: "function",
      nodeId: "fBase",
      funcDef: "add",
      returnId: "vr",
      children: [{ nodeType: "value", nodeId: "v0", value: num(0) }, vc],
    };
    for (let i = 1; i < DEEP; i += 1) {
      tree = {
        nodeType: "function",
        nodeId: "fInner",
        funcDef: "add",
        returnId: "vr",
        children: [tree, vc],
      };
    }

    let result: ReturnType<typeof executeTree>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => {
      result = executeTree(tree as any, context);
    }).not.toThrow();
    // Starting from 0 and adding 1 at each of the DEEP levels yields DEEP.
    expect(result!.value).toEqual(num(DEEP));
  });
});
