import { FuncId, ExecutionContext, ValueId } from "../types.js";
import { ExecutionTree, NodeId } from "./tree-types.js";
import type { ValueNode, FunctionNode, ConditionalNode } from "./tree-types.js";
import type { AnyValue } from "../../state-control/value.js";
import type { CombineDefineId, PipeDefineId, CondDefineId } from "../types.js";
import { isFuncId } from "../idValidation.js";
import { createMissingValueError } from "./errors.js";
import { TOM } from "../../util/tom.js";

/**
 * Creates a mapping from ValueId to FuncId for functions that produce those values.
 */
export function buildReturnIdToFuncIdMap(context: ExecutionContext): ReadonlyMap<ValueId, FuncId> {
  const returnIdToFuncId = new Map<ValueId, FuncId>();
  for (const [funcId, funcEntry] of TOM.entries(context.funcTable)) {
    returnIdToFuncId.set(funcEntry.returnId, funcId);
  }
  return returnIdToFuncId;
}

/**
 * A node's shape after classification: the (ordered) child node ids it depends
 * on plus enough captured data to assemble the node once those children have
 * been built. Splitting classification from assembly lets the iterative driver
 * schedule children before constructing the parent.
 */
type NodePlan =
  | { kind: "value"; nodeId: ValueId; value: AnyValue }
  | { kind: "redirect"; nodeId: ValueId; producer: FuncId }
  | {
      kind: "cond";
      nodeId: FuncId;
      defId: CondDefineId;
      returnId: ValueId;
      condId: NodeId;
      trueId: NodeId;
      falseId: NodeId;
    }
  | {
      kind: "func";
      nodeId: FuncId;
      defId: CombineDefineId | PipeDefineId;
      returnId: ValueId;
      argIds: NodeId[];
    };

/**
 * Classifies a node and surfaces its dependencies. Mirrors the body of the
 * former recursive builder, throwing the same errors for missing table entries.
 */
function classifyNode(
  nodeId: NodeId,
  context: ExecutionContext,
  returnIdToFuncId: ReadonlyMap<ValueId, FuncId>,
): NodePlan {
  // Leaf or redirect: a ValueId either names a pre-defined value or redirects
  // to the function that produces it.
  if (!isFuncId(nodeId, context.funcTable)) {
    const valueId = nodeId;
    const producerFuncId = returnIdToFuncId.get(valueId);
    if (producerFuncId !== undefined) {
      return { kind: "redirect", nodeId: valueId, producer: producerFuncId };
    }

    const value = context.valueTable[valueId];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (value === undefined) {
      throw createMissingValueError(valueId);
    }
    return { kind: "value", nodeId: valueId, value };
  }

  const funcId = nodeId;
  const funcEntry = context.funcTable[funcId];
  if (funcEntry === undefined) {
    throw new Error(`buildExecutionTree: no funcTable entry for ${funcId}`);
  }

  if (funcEntry.kind === "cond") {
    const condDef = context.condFuncDefTable[funcEntry.defId];
    if (condDef === undefined) {
      throw new Error(`buildExecutionTree: no condFuncDefTable entry for ${funcEntry.defId}`);
    }
    return {
      kind: "cond",
      nodeId: funcId,
      defId: funcEntry.defId,
      returnId: funcEntry.returnId,
      condId: condDef.conditionId.id,
      trueId: condDef.trueBranchId,
      falseId: condDef.falseBranchId,
    };
  }

  // funcEntry is now narrowed to combine | pipe
  return {
    kind: "func",
    nodeId: funcId,
    defId: funcEntry.defId,
    returnId: funcEntry.returnId,
    argIds: Object.values(funcEntry.argMap),
  };
}

/** The node ids that must be built before `plan`'s node can be assembled. */
function planDeps(plan: NodePlan): readonly NodeId[] {
  switch (plan.kind) {
    case "value":
      return [];
    case "redirect":
      return [plan.producer];
    case "cond":
      return [plan.condId, plan.trueId, plan.falseId];
    case "func":
      return plan.argIds;
  }
}

/** Looks up an already-built child tree, treating a miss as a logic error. */
function built(memo: ReadonlyMap<NodeId, ExecutionTree>, id: NodeId): ExecutionTree {
  const tree = memo.get(id);
  if (tree === undefined) {
    throw new Error(`buildExecutionTree: dependency ${id} was not built before its parent`);
  }
  return tree;
}

/** Assembles a node from its plan once all dependencies are present in `memo`. */
function assembleNode(plan: NodePlan, memo: ReadonlyMap<NodeId, ExecutionTree>): ExecutionTree {
  switch (plan.kind) {
    case "value": {
      const valueNode: ValueNode = {
        nodeType: "value",
        nodeId: plan.nodeId,
        value: plan.value,
      };
      return valueNode;
    }
    case "redirect":
      // The value's tree IS the producing function's tree.
      return built(memo, plan.producer);
    case "cond": {
      const conditionalNode: ConditionalNode = {
        nodeType: "conditional",
        nodeId: plan.nodeId,
        funcDef: plan.defId,
        returnId: plan.returnId,
        conditionTree: built(memo, plan.condId),
        trueBranchTree: built(memo, plan.trueId),
        falseBranchTree: built(memo, plan.falseId),
      };
      return conditionalNode;
    }
    case "func": {
      const children = plan.argIds.map((argId) => built(memo, argId));
      const functionNode: FunctionNode = {
        nodeType: "function",
        nodeId: plan.nodeId,
        funcDef: plan.defId,
        returnId: plan.returnId,
        ...(children.length > 0 && { children }),
      };
      return functionNode;
    }
  }
}

/**
 * Builds an execution tree rooted at nodeId. The reverse-lookup map is
 * constructed once internally so callers cannot accidentally trigger a
 * per-call recomputation.
 *
 * Traversal is iterative (an explicit work stack rather than native recursion)
 * so that deep dependency chains cannot overflow the call stack. Each frame is
 * visited twice: an "enter" pass classifies the node and schedules its
 * children, and an "exit" pass assembles the node once those children are in
 * `memo`. Shared DAG nodes (diamonds) are built once and reused via `memo`;
 * `visiting` tracks the current ancestor chain to detect cycles defensively.
 */
export function buildExecutionTree(nodeId: NodeId, context: ExecutionContext): ExecutionTree {
  const returnIdToFuncId = buildReturnIdToFuncIdMap(context);
  const memo = new Map<NodeId, ExecutionTree>();
  const visiting = new Set<NodeId>();

  type Frame = { nodeId: NodeId; plan?: NodePlan };
  const stack: Frame[] = [{ nodeId }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;

    if (frame.plan === undefined) {
      // Enter: classify and schedule children.
      const current = frame.nodeId;
      if (memo.has(current)) {
        stack.pop();
        continue;
      }
      if (visiting.has(current)) {
        throw new Error(`Cycle detected at node ${current}`);
      }
      visiting.add(current);
      const plan = classifyNode(current, context, returnIdToFuncId);
      frame.plan = plan;
      for (const dep of planDeps(plan)) {
        stack.push({ nodeId: dep });
      }
    } else {
      // Exit: all dependencies have been built (or were already memoized).
      memo.set(frame.nodeId, assembleNode(frame.plan, memo));
      visiting.delete(frame.nodeId);
      stack.pop();
    }
  }

  return built(memo, nodeId);
}
