# Tree-Based Execution Design

## Core Concept

Execution is a **tree traversal**, not a graph traversal:
- **Root**: The function being executed (entry point)
- **Internal nodes**: Functions that depend on other functions
- **Leaves**: Pre-defined values from valueTable

## Tree Structure

```typescript
type ExecutionTree = {
  nodeId: FuncId | ValueId;
  nodeType: 'function' | 'value';

  // For function nodes
  funcDef?: PlugDefineId | TapDefineId | CondDefineId;
  children?: ExecutionTree[]; // dependencies/arguments

  // For value nodes (leaves)
  value?: AnyValue;
};
```

## Execution Model

### Current (Graph-based)
1. Build full dependency graph (BFS traversal)
2. Calculate in-degrees
3. Topological sort
4. Execute in sorted order

**Problems:**
- Over-engineered for tree structure
- Unnecessary cycle detection (trees can't cycle)
- Complex in-degree tracking
- Harder to understand

### Proposed (Tree-based)
1. Build execution tree (recursive descent from root)
2. Execute via post-order traversal (leaves first, root last)

**Benefits:**
- Much simpler code
- Natural recursion matches mental model
- Easy to add conditional branches
- Clear execution order

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

## Adding Conditionals (`if`)

With tree structure, conditionals are natural:

```typescript
type CondDefine = {
  condition: FuncId | ValueId; // evaluates to boolean
  trueBranch: FuncId;
  falseBranch: FuncId;
};
```

Tree for conditional:
```
if-node
├── condition (evaluates first)
├── trueBranch (execute if true)
└── falseBranch (execute if false)
```

**Execution:**
1. Evaluate condition subtree
2. Based on result, execute ONLY one branch
3. Return result from executed branch

**Multiple leaves = different paths!** This is exactly what you mentioned.

## Simplified Implementation

### Old (Graph):
```typescript
buildDependencyGraph() {
  // 120 lines of complex graph construction
  // BFS, edge tracking, in-degree calculation
}

topologicalSort() {
  // 45 lines of Kahn's algorithm
}
```

### New (Tree):
```typescript
buildExecutionTree(nodeId: NodeId, context: ExecutionContext): ExecutionTree {
  if (isValueId(nodeId)) {
    return {
      nodeId,
      nodeType: 'value',
      value: context.valueTable[nodeId],
    };
  }

  const funcEntry = context.funcTable[nodeId];
  const children = Object.values(funcEntry.argMap).map(
    argId => buildExecutionTree(argId, context)
  );

  return {
    nodeId,
    nodeType: 'function',
    funcDef: funcEntry.defId,
    children,
  };
}

executeTree(tree: ExecutionTree, context: ExecutionContext): AnyValue {
  if (tree.nodeType === 'value') {
    return tree.value;
  }

  // Post-order: execute children first
  const childResults = tree.children.map(child => executeTree(child, context));

  // Then execute this function with child results
  return executeFunctionNode(tree, childResults, context);
}
```

Much simpler! ~30 lines instead of ~165 lines.

## Advantages for Your Design

1. **Clearer mental model**: Tree = execution flow
2. **Natural conditional support**: Multiple branches = multiple paths
3. **Simpler code**: Recursion instead of graph algorithms
4. **Better debugging**: Can visualize tree easily
5. **Lazy evaluation**: Only evaluate needed branches
6. **No impossible states**: Can't have cycles in a tree

## Migration Path

1. Keep current types (FuncTable, ValueTable, etc.) - they're fine
2. Replace buildDependencyGraph + topologicalSort with buildExecutionTree
3. Replace executeGraph loop with recursive executeTree
4. Add CondFunc support with tree branches
5. Remove cycle detection (impossible in trees)

## Future: Loops

Loops can be handled as special tree nodes that repeat a subtree:

```
loop-node (map over array)
├── collection (value: array)
└── body (subtree executed for each item)
```

Tree is duplicated conceptually for each iteration, but implementation can optimize this.
