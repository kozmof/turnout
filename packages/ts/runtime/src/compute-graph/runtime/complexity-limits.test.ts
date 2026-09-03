import { describe, expect, it } from "vitest";
import { validateContext } from "./validateContext.js";
import { MAX_GRAPH_NODES } from "./limits.js";
import type { ExecutionContext } from "../types.js";

const num = (value: number) => ({ symbol: "number", value, subSymbol: undefined, tags: [] });
const DEEP = 40_000;

describe("compute-graph complexity limits", () => {
  it("rejects models exceeding the node budget instead of overflowing", () => {
    const valueTable: Record<string, ReturnType<typeof num>> = {};
    for (let i = 0; i <= MAX_GRAPH_NODES; i += 1) valueTable[`v${i}`] = num(i);
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
    expect(result!.errors.some((error) => error.message.includes("too large"))).toBe(true);
  });

  it("validates a deep dependency chain without a stack overflow", () => {
    const funcTable: Record<string, unknown> = {};
    for (let i = 0; i < DEEP; i += 1) {
      funcTable[`f${i}`] = {
        kind: "combine",
        defId: "add",
        argMap: { a: i === 0 ? "v0" : `r${i - 1}`, b: "vc" },
        returnId: `r${i}`,
      };
    }
    const context = {
      valueTable: { v0: num(0), vc: num(1) },
      funcTable,
      combineFuncDefTable: {
        add: {
          name: "combineFnNumber::add",
          transformFn: { a: ["transformFnNumber::pass"], b: ["transformFnNumber::pass"] },
          args: { a: "ia1", b: "ia2" },
        },
      },
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as unknown as ExecutionContext;
    expect(() => validateContext(context)).not.toThrow();
  });
});
