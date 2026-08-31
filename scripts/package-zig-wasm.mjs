import { copyFile, mkdir, readFile } from "node:fs/promises";

const source = new URL("../packages/zig/zig-out/bin/turnout-runtime.wasm", import.meta.url);
const destinationDirectory = new URL(
  "../packages/ts/scene-runner/dist/zig-runtime/",
  import.meta.url,
);
const destination = new URL("turnout-runtime.wasm", destinationDirectory);

const bytes = await readFile(source);
if (bytes.length < 8 || !bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
  throw new Error("Zig build output is not a WebAssembly module");
}

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
