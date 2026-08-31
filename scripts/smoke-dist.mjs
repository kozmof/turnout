import { readFile } from "node:fs/promises";

await import("../packages/ts/runtime/dist/index.js");
await import("../packages/ts/scene-runner/dist/index.js");
await import("../packages/ts/scene-runner/dist/server/index.js");

const wasm = await readFile(
  new URL("../packages/ts/scene-runner/dist/zig-runtime/turnout-runtime.wasm", import.meta.url),
);
if (wasm.length < 8 || !wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) {
  throw new Error("scene-runner distribution is missing its Zig WASM module");
}
console.log("dist smoke imports passed");
