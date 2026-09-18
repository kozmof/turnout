import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const versions = JSON.parse(await readFile(new URL("spec/runtime-versions.json", root), "utf8"));

const checks = [
  {
    // The compiler stamps the version every runtime then checks, so it belongs
    // in this gate more than either runtime does. min_version and max_version
    // are deliberately absent: they are a compatibility window the compiler is
    // free to widen, not a restatement of the model version.
    file: "packages/go/converter/internal/emit/json.go",
    pattern: /jsonModelVersion = (\d+)/,
    expected: versions.model,
    name: "Go model",
  },
  {
    file: "packages/ts/scene-runner/src/migration.ts",
    pattern: /const CURRENT_VERSION = (\d+);/,
    expected: versions.model,
    name: "TypeScript model",
  },
  {
    file: "packages/zig/scene-runner/src/model.zig",
    pattern: /pub const current_version: u32 = (\d+);/,
    expected: versions.model,
    name: "Zig model",
  },
  {
    file: "packages/ts/runtime/src/zig-runtime/client.ts",
    pattern: /const ABI_VERSION = (\d+);/,
    expected: versions.abi,
    name: "TypeScript ABI",
  },
  {
    file: "packages/zig/wasm/src/abi.zig",
    pattern: /pub const abi_version: u16 = (\d+);/,
    expected: versions.abi,
    name: "Zig ABI",
  },
];

for (const check of checks) {
  const source = await readFile(new URL(check.file, root), "utf8");
  const match = check.pattern.exec(source);
  assert(match, `${check.name} version declaration not found in ${check.file}`);
  assert.equal(
    Number(match[1]),
    check.expected,
    `${check.name} version must match spec/runtime-versions.json`,
  );
}
