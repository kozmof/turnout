import { describe, expect, it } from "vitest";
import { executeTree } from "./executeTree";
import type { ExecutionContext } from "../types";

describe("executeTree", () => {
  it("rejects non-boolean conditional results", () => {
    const context: ExecutionContext = {
      valueTable: {
        v_condition: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
        v_true: { symbol: "number", value: 2, subSymbol: undefined, tags: [] },
        v_false: { symbol: "number", value: 3, subSymbol: undefined, tags: [] },
      } as any,
      funcTable: {},
      combineFuncDefTable: {},
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    } as ExecutionContext;

    const tree = {
      nodeType: "conditional",
      nodeId: "f_condition",
      conditionTree: {
        nodeType: "value",
        nodeId: "v_condition",
        value: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
      },
      trueBranchTree: {
        nodeType: "value",
        nodeId: "v_true",
        value: { symbol: "number", value: 2, subSymbol: undefined, tags: [] },
      },
      falseBranchTree: {
        nodeType: "value",
        nodeId: "v_false",
        value: { symbol: "number", value: 3, subSymbol: undefined, tags: [] },
      },
    } as any;

    expect(() => executeTree(tree, context)).toThrow(
      "Condition must evaluate to boolean, got number",
    );
  });

  it("reads leaf values from the execution context, not the cached tree node", () => {
    const context: ExecutionContext = {
      valueTable: {
        v1: { symbol: "number", value: 2, subSymbol: undefined, tags: [] },
      } as any,
      funcTable: {},
      combineFuncDefTable: {},
      pipeFuncDefTable: {},
      condFuncDefTable: {},
    };

    const tree = {
      nodeType: "value",
      nodeId: "v1",
      value: { symbol: "number", value: 1, subSymbol: undefined, tags: [] },
    } as any;

    expect(executeTree(tree, context).value).toEqual({
      symbol: "number",
      value: 2,
      subSymbol: undefined,
      tags: [],
    });
  });
});
