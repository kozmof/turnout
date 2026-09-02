import { readFile } from "node:fs/promises";
import { instantiateZigRuntime } from "./client.js";

async function loadRuntimeBytes(): Promise<Uint8Array> {
  const packagedUrl = new URL("./turnout-runtime.wasm", import.meta.url);
  try {
    return await readFile(packagedUrl);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return readFile(new URL("../../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url));
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export const defaultZigRuntimeClient = await instantiateZigRuntime(await loadRuntimeBytes());
