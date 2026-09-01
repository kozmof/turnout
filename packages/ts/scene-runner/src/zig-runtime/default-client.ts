import { instantiateZigRuntime } from "./client.js";

export const defaultZigRuntimeClient = await instantiateZigRuntime(await loadRuntimeBytes());

async function loadRuntimeBytes(): Promise<Uint8Array> {
  const packagedUrl = new URL("./turnout-runtime.wasm", import.meta.url);
  if (packagedUrl.protocol !== "file:") {
    const response = await fetch(packagedUrl);
    if (!response.ok) {
      throw new Error(`failed to load Zig runtime WASM: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  const { readFile } = await import("node:fs/promises");
  try {
    return await readFile(packagedUrl);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return readFile(new URL("../../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url));
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
