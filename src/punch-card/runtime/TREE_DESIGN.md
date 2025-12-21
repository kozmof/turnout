# Tree-Based Execution Design

## Status: ✅ IMPLEMENTED

All features described in this document have been successfully implemented and tested.

## Core Concept

Execution is a **tree traversal**, not a graph traversal:
- **Root**: The function being executed (entry point)
- **Internal nodes**: Functions that depend on other functions
- **Leaves**: Pre-defined values from valueTable

## Tree Structure

```typescript
type ExecutionTree = {
  nodeId: FuncId | ValueId;
  nodeType: 'function' | 'value' | 'conditional';

  // For function nodes
  funcDef?: PlugDefineId | TapDefineId | CondDefineId;
  children?: ExecutionTree[]; // dependencies/arguments
  returnId?: ValueId;

  // For conditional nodes
  conditionTree?: ExecutionTree;
  trueBranchTree?: ExecutionTree;
  falseBranchTree?: ExecutionTree;

  // For value nodes (leaves)
  value?: AnyValue;
};
```

## Execution Model

### Old (Graph-based) - REMOVED
1. Build full dependency graph (BFS traversal)
2. Calculate in-degrees
3. Topological sort
4. Execute in sorted order

**Problems:**
- Over-engineered for tree structure
- Unnecessary cycle detection (trees can't cycle)
- Complex in-degree tracking
- Harder to understand

### Current (Tree-based) - ✅ IMPLEMENTED
1. Build execution tree (recursive descent from root)
2. Execute via post-order traversal (leaves first, root last)
3. For conditionals: evaluate condition, then execute only one branch (lazy evaluation)

**Benefits:**
- Much simpler code (~50% reduction)
- Natural recursion matches mental model
- ✅ Conditional branches implemented and tested
- Clear execution order
- Lazy evaluation for conditionals (only selected branch executes)

## Example

Given:
```
e = func1(a, b)
f = func2(e, c, d)
g = func3(a, f)
```

Tree for `g`:
```
g: func3
├── a (value)
└── f: func2
    ├── e: func1
    │   ├── a (value)
    │   └── b (value)
    ├── c (value)
    └── d (value)
```

Post-order execution: `a → b → func1(e) → c → d → func2(f) → func3(g)`

## Conditionals (`if`) - ✅ IMPLEMENTED

With tree structure, conditionals are natural:

```typescript
type CondFuncDefTable = {
  [defId in CondDefineId]: {
    conditionId: FuncId | ValueId;  // evaluates to boolean
    trueBranchId: FuncId;            // execute if true
    falseBranchId: FuncId;           // execute if false
  };
};
```

Tree for conditional:
```
if-node (conditional)
├── conditionTree (evaluates first)
├── trueBranchTree (execute if condition.value === true)
└── falseBranchTree (execute if condition.value === false)
```

**Execution (implemented in executeTree.ts:20-46):**
1. Evaluate condition subtree
2. Check that result is boolean type
3. Based on result, execute ONLY one branch (lazy evaluation!)
4. Store and return result from executed branch

**Multiple leaves = different paths!** ✅ This prediction was correct.

**Key implementation details:**
- Condition can be a pre-defined boolean value OR a computed function result
- Only the selected branch executes (the other branch is never evaluated)
- Type checking ensures condition evaluates to boolean
- Result type can be any value type (number, string, array, etc.)

## Implementation Comparison

### Old (Graph-based) - REMOVED
```typescript
buildDependencyGraph() {
  // 120 lines of complex graph construction
  // BFS, edge tracking, in-degree calculation
}

topologicalSort() {
  // 45 lines of Kahn's algorithm
}

executeNode() {
  // Node dispatch logic
}

// Total: ~165 lines + complexity
```

### Current (Tree-based) - ✅ IMPLEMENTED
```typescript
// buildExecutionTree.ts - ~70 lines
buildExecutionTree(nodeId: NodeId, context: ExecutionContext): ExecutionTree {
  if (isValueId(nodeId)) {
    // Handle value nodes (leaves)
  }

  if (isCondDefineId(defId)) {
    // Handle conditional nodes - build 3 subtrees
    return {
      nodeType: 'conditional',
      conditionTree: buildExecutionTree(condDef.conditionId),
      trueBranchTree: buildExecutionTree(condDef.trueBranchId),
      falseBranchTree: buildExecutionTree(condDef.falseBranchId),
    };
  }

  // Handle regular function nodes
  const children = argMap.map(argId => buildExecutionTree(argId));
  return { nodeType: 'function', children };
}

// executeTree.ts - ~40 lines
executeTree(tree: ExecutionTree, context: ExecutionContext): AnyValue {
  if (tree.nodeType === 'value') {
    return tree.value;
  }

  if (tree.nodeType === 'conditional') {
    const condResult = executeTree(tree.conditionTree);
    // Execute ONLY one branch based on condition
    return condResult.value
      ? executeTree(tree.trueBranchTree)
      : executeTree(tree.falseBranchTree);
  }

  // Post-order: execute children first, then function
  tree.children.forEach(child => executeTree(child));
  executeFunction(tree.funcDef);
  return context.valueTable[tree.returnId];
}

// Total: ~110 lines, much clearer logic
```

**Result: ~50% less code, infinitely clearer!**

## Advantages (All Realized!)

1. ✅ **Clearer mental model**: Tree = execution flow
2. ✅ **Natural conditional support**: Multiple branches = multiple paths (IMPLEMENTED!)
3. ✅ **Simpler code**: Recursion instead of graph algorithms (~50% reduction)
4. ✅ **Better debugging**: Can visualize tree easily
5. ✅ **Lazy evaluation**: Only evaluate needed branches (conditionals!)
6. ✅ **No impossible states**: Can't have cycles in a tree

## Migration Completed ✅

1. ✅ Kept current types (FuncTable, ValueTable, etc.)
2. ✅ Replaced buildDependencyGraph + topologicalSort with buildExecutionTree
3. ✅ Replaced executeGraph loop with recursive executeTree
4. ✅ Added CondFunc support with tree branches
5. ✅ Removed cycle detection (only catches actual cycles now)

**Files removed:**
- `buildDependencyGraph.ts` (120 lines)
- `topologicalSort.ts` (45 lines)
- `executeNode.ts`

**Files created:**
- `buildExecutionTree.ts` (~70 lines)
- `executeTree.ts` (~40 lines)
- `executeCondFunc.ts` (~35 lines)
- `tree-types.ts` (~22 lines)

## Test Coverage ✅

All functionality is tested with 11 passing tests:

**Original functionality (8 tests):**
- Simple PlugFunc execution
- Nested PlugFuncs with dependencies
- Shared function definitions
- TapFunc with sequence
- Transform functions
- Error handling: cyclic dependency
- Error handling: missing value
- Error handling: empty TapFunc sequence

**New conditional functionality (3 tests):**
- CondFunc with true branch (static condition)
- CondFunc with false branch (static condition)
- CondFunc with computed condition (function result)

## Future: Loops (Not Yet Implemented)

Loops can be handled as special tree nodes that repeat a subtree:

```typescript
type LoopFuncDefTable = {
  [defId in LoopDefineId]: {
    loopType: 'map' | 'filter' | 'reduce' | 'forEach';
    collectionId: ValueId;        // array to iterate
    bodyFuncId: FuncId;            // function applied to each item
    accumulatorId?: ValueId;       // for reduce
  };
};
```

Tree for loop:
```
loop-node (map over array)
├── collection (value: array)
└── body (subtree executed for each item)
```

**Implementation approach:**
- Tree structure remains the same, body is duplicated for each iteration
- Or optimize by executing body tree N times with different item values
- Results are collected into a new array/accumulated value

Tree is duplicated conceptually for each iteration, but implementation can optimize this by reusing the body subtree.
