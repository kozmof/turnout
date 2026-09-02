import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const source = fileURLToPath(
  new URL("../packages/zig/zig-out/bin/turnout-runtime.wasm", import.meta.url),
);
const outputDirectory = fileURLToPath(
  new URL("../packages/ts/runtime/dist/zig-runtime", import.meta.url),
);
const output = join(outputDirectory, "turnout-runtime.wasm");

const bytes = await readFile(source);
if (bytes.length < 8 || bytes.subarray(0, 4).toString("hex") !== "0061736d") {
  throw new Error(`invalid WebAssembly artifact at ${source}`);
}
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, output);
