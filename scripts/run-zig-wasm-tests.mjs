import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WASI } from "node:wasi";

// One artifact per Zig module: tests are discovered only within the module
// under test, so each feature layer ships its own test binary.
const artifacts = ["turnout-runtime-tests", "turnout-scene-runner-tests", "turnout-wasm-abi-tests"];

const requestedArtifact = process.argv[2];

if (requestedArtifact) {
  if (!artifacts.includes(requestedArtifact)) {
    console.error(`Unknown WASI test artifact: ${requestedArtifact}`);
    process.exit(1);
  }

  const artifact = new URL(
    `../packages/zig/zig-out/bin/${requestedArtifact}.wasm`,
    import.meta.url,
  );
  const wasi = new WASI({
    version: "preview1",
    args: [requestedArtifact],
    env: {},
    preopens: {},
  });
  const module = await WebAssembly.compile(await readFile(artifact));
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  process.exitCode = wasi.start(instance);
} else {
  let failed = false;
  const script = fileURLToPath(import.meta.url);

  for (const name of artifacts) {
    const result = spawnSync(process.execPath, ["--no-warnings", script, name], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      console.error(`${name} exited with ${result.signal ?? `code ${result.status ?? 1}`}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}
