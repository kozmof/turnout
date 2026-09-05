import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";

// One artifact per Zig module: tests are discovered only within the module
// under test, so each feature layer ships its own test binary.
const artifacts = ["turnout-runtime-tests", "turnout-scene-runner-tests", "turnout-wasm-abi-tests"];

let failed = false;

for (const name of artifacts) {
  const artifact = new URL(`../packages/zig/zig-out/bin/${name}.wasm`, import.meta.url);
  const wasi = new WASI({
    version: "preview1",
    args: [name],
    env: {},
    preopens: {},
  });
  const module = await WebAssembly.compile(await readFile(artifact));
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  const code = wasi.start(instance);
  if (code !== 0) {
    console.error(`${name} exited with code ${code}`);
    failed = true;
  }
}

if (failed) process.exit(1);
