// Generates the shared bound constants from spec/limits.json, for Go and Zig.
// Run: node --experimental-strip-types scripts/gen-limits.ts
//
// These used to be hand-written in each language and compared against the spec
// by scripts/check-limits.mjs, which read each declaration back out with a
// regular expression. That caught drift, which is better than the nothing that
// came before it — the engine parsed a STATE type into a 128-node pool while
// the compiler had no limit at all, and emitted models the engine refused to
// load. But detecting drift is the weaker of the two available guarantees, and
// this repository already takes the stronger one for every other shared name:
// spec/fn-aliases.json and spec/unicode-case-map.json are generated, so the two
// sides cannot disagree in the first place.
//
// Limits now work the same way. Each language gets one generated file, every
// declaration references it, and changing a bound is editing spec/limits.json
// and re-running this.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = "spec/limits.json";
const limits = JSON.parse(readFileSync(resolve(root, specPath), "utf-8")) as Record<string, number>;

/**
 * Each bound, with the prose that says what it actually bounds. The spec file
 * is data and carries no comments, so the explanations live here and are
 * written into both generated files — a reader reaching the constant from the
 * code that uses it should not have to go find out what it is for.
 */
const documented: ReadonlyArray<{ key: string; go: string; zig: string; why: string[] }> = [
  {
    key: "stateTypeNodes",
    go: "StateTypeNodes",
    zig: "state_type_nodes",
    why: [
      "How many nodes a STATE field type may be built from: one per `arr<`,",
      "one per `rec<`, and one for the primitive at the bottom.",
      "",
      "This is the bound both languages hold, and the reason the rest are",
      "written down beside it. The engine parses a type into a pool of this",
      "many nodes; the compiler refuses a deeper type against the source file",
      "it parsed, so the error arrives with a line and column instead of as a",
      "model that will not load.",
    ],
  },
  {
    key: "sourceExpressionDepth",
    go: "SourceExpressionDepth",
    zig: "source_expression_depth",
    why: [
      "How deeply expressions may nest in source. Unlike the others this",
      "bounds a recursive descent rather than a data structure: past it the",
      "parser overflows the stack, which is not recoverable into a diagnostic.",
    ],
  },
  {
    key: "modelNesting",
    go: "ModelNesting",
    zig: "model_nesting",
    why: ["How deeply a loaded model's JSON may nest."],
  },
  {
    key: "inputNesting",
    go: "InputNesting",
    zig: "input_nesting",
    why: ["How deeply JSON handed across the WASM ABI may nest."],
  },
  {
    key: "graphDepth",
    go: "GraphDepth",
    zig: "graph_depth",
    why: ["How deeply an authoring compute graph may nest."],
  },
  {
    key: "inferenceDepth",
    go: "InferenceDepth",
    zig: "inference_depth",
    why: ["How deeply return-type inference may recurse."],
  },
];

const known = new Set(documented.map((entry) => entry.key));
for (const key of Object.keys(limits)) {
  if (!known.has(key)) {
    throw new Error(
      `${specPath} declares "${key}", which this generator does not know how to emit. ` +
        `Add it to the table in scripts/gen-limits.ts — a bound no language reads is a bound nothing enforces.`,
    );
  }
}
for (const entry of documented) {
  if (typeof limits[entry.key] !== "number") {
    throw new Error(`${specPath} is missing the "${entry.key}" bound`);
  }
}

const banner = (comment: string) => [
  `${comment} AUTO-GENERATED. DO NOT EDIT.`,
  `${comment} Source of truth: ${specPath}`,
  `${comment} Regenerate: node --experimental-strip-types scripts/gen-limits.ts`,
];

const goOut = [
  ...banner("//"),
  "",
  "// Package limits holds the bounds the compiler and the engine both have to",
  "// agree on. A limit one side chose alone is how a model the compiler accepted",
  `// became one the engine refused to load; ${specPath} is where they are chosen.`,
  "package limits",
  "",
  "const (",
  ...documented.flatMap((entry, index) => [
    ...(index === 0 ? [] : [""]),
    ...entry.why.map((line) => (line === "" ? "\t//" : `\t// ${line}`)),
    `\t${entry.go} = ${limits[entry.key]}`,
  ]),
  ")",
  "",
].join("\n");

// Zig requires container doc comments at the very top of the file, so the
// banner is written as `//!` rather than sitting above one as plain comments.
const zigOut = [
  ...banner("//!"),
  "//!",
  "//! The bounds the compiler and the engine both have to agree on. A limit one",
  "//! side chose alone is how a model the compiler accepted became one the engine",
  `//! refused to load; ${specPath} is where they are chosen.`,
  "",
  ...documented.flatMap((entry, index) => [
    ...(index === 0 ? [] : [""]),
    ...entry.why.map((line) => (line === "" ? "///" : `/// ${line}`)),
    `pub const ${entry.zig}: usize = ${limits[entry.key]};`,
  ]),
  "",
].join("\n");

const targets: ReadonlyArray<{ path: string; contents: string }> = [
  { path: "packages/go/converter/internal/limits/limits.go", contents: goOut },
  { path: "packages/zig/runtime/src/generated/limits.zig", contents: zigOut },
];

for (const target of targets) {
  const destination = resolve(root, target.path);
  writeFileSync(destination, target.contents);
  console.log(`Generated ${destination}`);
}
