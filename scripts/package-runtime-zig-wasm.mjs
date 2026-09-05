import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The distributed WASM artifacts, in the order `wasm-dist` builds them.
 *
 * Two builds of the same source for two deployments: `turnout-runtime.wasm` is
 * optimized for speed and is what a server or CLI host should load;
 * `turnout-runtime.compact.wasm` is about a seventh of the size for about 14%
 * less throughput, which is the trade a browser wants.
 */
const artifacts = ["turnout-runtime.wasm", "turnout-runtime.compact.wasm"];

/**
 * Read from zig-out/dist rather than zig-out/bin. The development build lands in
 * bin, and packaging it would ship an unoptimized module that behaves correctly
 * and runs about three times slower.
 */
const sourceDirectory = fileURLToPath(new URL("../packages/zig/zig-out/dist", import.meta.url));
const outputDirectory = fileURLToPath(
  new URL("../packages/ts/runtime/dist/zig-runtime", import.meta.url),
);

await mkdir(outputDirectory, { recursive: true });
for (const artifact of artifacts) {
  const source = join(sourceDirectory, artifact);
  let bytes;
  try {
    bytes = await readFile(source);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      `missing ${artifact}: run \`pnpm run build:zig:dist\` before packaging the runtime`,
      { cause: error },
    );
  }
  if (bytes.length < 8 || bytes.subarray(0, 4).toString("hex") !== "0061736d") {
    throw new Error(`invalid WebAssembly artifact at ${source}`);
  }
  await copyFile(source, join(outputDirectory, artifact));
}
