import { ExecutionContext, type ExecutionResult, type ValueTable } from "../types.js";
import { ExecutionTree } from "./tree-types.js";
import type { AnyValue } from "../../state-control/value.js";
import { isCombineDefineId, isPipeDefineId } from "../idValidation.js";
import { createFunctionExecutionError, createMissingValueError } from "./errors.js";
import { executeCombineFunc } from "./exec/executeCombineFunc.js";
import { executePipeFunc } from "./exec/executePipeFunc.js";
import { executeCondFunc } from "./exec/executeCondFunc.js";

/**
 * A frame on the explicit execution stack. `phase` doubles as the conditional
 * sub-step (0: evaluate condition, 1: pick + run branch, 2: run cond func) and
 * the function node's next-child index. Value nodes ignore it.
 */
type ExecFrame = { tree: ExecutionTree; phase: number };

/**
 * Treats a missing intermediate value as a logic error. By construction every
 * frame leaves a value in the register before its parent reads it.
 */
function takeValue(value: AnyValue | undefined): AnyValue {
  if (value === undefined) {
    throw new Error("executeTree: internal error — expected an intermediate value");
  }
  return value;
}

/**
 * Executes an execution tree and returns the result along with updated state.
 * This is a pure function - it does not mutate the input context.
 *
 * Traversal is iterative (an explicit work stack rather than native recursion)
 * so deeply nested trees cannot overflow the call stack. State is threaded
 * left-to-right exactly as a post-order recursion would: `currentValueTable`
 * carries the running value table and `lastValue` carries the most recently
 * produced value back to the parent frame. A combined context object is only
 * constructed right before invoking an executor.
 *
 * @param tree - The execution tree to execute
 * @param context - The execution context (read-only)
 * @returns Execution result with computed value and updated value table
 */
export function executeTree(tree: ExecutionTree, context: ExecutionContext): ExecutionResult {
  let currentValueTable: ValueTable = context.valueTable;
  let lastValue: AnyValue | undefined;

  const stack: ExecFrame[] = [{ tree, phase: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const node = frame.tree;

    // Base case: value node (leaf)
    if (node.nodeType === "value") {
      const value = currentValueTable[node.nodeId];
      if (value === undefined) {
        throw createMissingValueError(node.nodeId);
      }
      lastValue = value;
      stack.pop();
      continue;
    }

    // Conditional node: evaluate condition, then execute only one branch.
    if (node.nodeType === "conditional") {
      if (frame.phase === 0) {
        frame.phase = 1;
        stack.push({ tree: node.conditionTree, phase: 0 });
        continue;
      }
      if (frame.phase === 1) {
        const conditionValue = takeValue(lastValue);
        if (conditionValue.symbol !== "boolean") {
          throw createFunctionExecutionError(
            node.nodeId,
            `Condition must evaluate to boolean, got ${conditionValue.symbol}`,
          );
        }
        frame.phase = 2;
        const branch = conditionValue.value ? node.trueBranchTree : node.falseBranchTree;
        stack.push({ tree: branch, phase: 0 });
        continue;
      }
      // phase 2: the chosen branch has produced its value.
      const branchValue = takeValue(lastValue);
      const result = executeCondFunc(
        node.nodeId,
        withValueTable(context, currentValueTable),
        branchValue,
      );
      currentValueTable = result.updatedValueTable;
      lastValue = result.value;
      stack.pop();
      continue;
    }

    // Regular function node: execute children first (post-order), threading the
    // value table through each, then invoke the executor.
    const children = node.children;
    if (children !== undefined && frame.phase < children.length) {
      const child = children[frame.phase];
      frame.phase += 1;
      if (child === undefined) continue;
      stack.push({ tree: child, phase: 0 });
      continue;
    }

    const updatedContext = withValueTable(context, currentValueTable);
    const funcId = node.nodeId;
    const defId = node.funcDef;

    let result: ExecutionResult;
    if (isCombineDefineId(defId, context.combineFuncDefTable)) {
      result = executeCombineFunc(funcId, defId, updatedContext);
    } else if (isPipeDefineId(defId, context.pipeFuncDefTable)) {
      result = executePipeFunc(funcId, defId, updatedContext);
    } else {
      throw createFunctionExecutionError(funcId, `Unknown definition type for ${String(defId)}`);
    }
    currentValueTable = result.updatedValueTable;
    lastValue = result.value;
    stack.pop();
  }

  return {
    value: takeValue(lastValue),
    updatedValueTable: currentValueTable,
  };
}

function withValueTable(context: ExecutionContext, valueTable: ValueTable): ExecutionContext {
  if (context.valueTable === valueTable) return context;
  return {
    valueTable,
    funcTable: context.funcTable,
    combineFuncDefTable: context.combineFuncDefTable,
    pipeFuncDefTable: context.pipeFuncDefTable,
    condFuncDefTable: context.condFuncDefTable,
  };
}
