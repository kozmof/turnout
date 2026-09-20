// Pins spec/limits.json to the constants that enforce it.
//
// Every shared *name* in this repository is already gated — field types,
// function aliases, the runtime projection, the model and ABI versions. No
// shared *bound* was, and the bounds are where the compiler and the engine had
// already drifted: the engine parsed a STATE type into a 128-node pool and
// rejected anything larger, while the compiler had no limit at all and emitted
// models the engine could not load. Nothing failed, because the two numbers
// were never written down in the same place.
//
// `stateTypeNodes` is the one enforced in two languages, and it is the reason
// this file exists. The rest are enforced in one each. They are here anyway: a
// limit chosen in isolation is how the first one drifted, and a second host
// needs the list to build against. Recording them costs a line and makes a
// change to any of them visible in a spec diff rather than only in the language
// that happens to hold it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const limits = JSON.parse(await readFile(new URL("spec/limits.json", root), "utf8"));

const checks = [
  {
    // The compiler's cap on STATE type nesting. It exists to match the engine's
    // node pool below: a type the engine cannot represent is a type error, and
    // type errors are the compiler's to report against the file it parsed.
    file: "packages/go/converter/internal/ast/ast.go",
    pattern: /const MaxTypeNodes = (\d+)/,
    expected: limits.stateTypeNodes,
    name: "Go STATE type nodes",
  },
  {
    // The engine's node pool. A STATE type is parsed into it once per
    // declaration and walked on every write.
    file: "packages/zig/scene-runner/src/state.zig",
    pattern: /nodes: \[(\d+)\]SchemaNode/,
    expected: limits.stateTypeNodes,
    name: "Zig STATE type nodes",
  },
  {
    // The compiler's cap on expression nesting in source. Unlike the others
    // this one bounds a recursive descent rather than a data structure: past it
    // the parser overflows the stack, which Go cannot recover into a
    // diagnostic.
    file: "packages/go/converter/internal/parser/parser.go",
    pattern: /const maxExpressionDepth = (\d+)/,
    expected: limits.sourceExpressionDepth,
    name: "Go source expression depth",
  },
  {
    file: "packages/zig/scene-runner/src/model.zig",
    pattern: /max_nesting: usize = (\d+)/,
    expected: limits.modelNesting,
    name: "Zig model nesting",
  },
  {
    file: "packages/zig/wasm/src/abi.zig",
    pattern: /pub const max_input_nesting: usize = (\d+);/,
    expected: limits.inputNesting,
    name: "Zig ABI input nesting",
  },
  {
    file: "packages/zig/runtime/src/authoring/graph_compute.zig",
    pattern: /pub const max_graph_depth: usize = (\d+);/,
    expected: limits.graphDepth,
    name: "Zig graph depth",
  },
  {
    file: "packages/zig/wasm/src/abi.zig",
    pattern: /pub const max_inference_depth: usize = (\d+);/,
    expected: limits.inferenceDepth,
    name: "Zig inference depth",
  },
];

for (const check of checks) {
  const source = await readFile(new URL(check.file, root), "utf8");
  const match = check.pattern.exec(source);
  assert(match, `${check.name} limit declaration not found in ${check.file}`);
  assert.equal(Number(match[1]), check.expected, `${check.name} must match spec/limits.json`);
}
