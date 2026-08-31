import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

const artifact = new URL(
  "../packages/zig/zig-out/bin/turnout-core-tests.wasm",
  import.meta.url,
);
const wasi = new WASI({
  version: "preview1",
  args: ["turnout-core-tests"],
  env: {},
  preopens: {},
});
const module = await WebAssembly.compile(await readFile(artifact));
const instance = await WebAssembly.instantiate(
  module,
  wasi.getImportObject(),
);
wasi.start(instance);
