import type { ZigRuntimeLifecycleTransport } from "./runner-adapter.js";

export type InternalEngineSelection =
  | { kind: "typescript" }
  | { kind: "zig"; client: ZigRuntimeLifecycleTransport };

export function requestedDefaultEngine(value: string | undefined): "typescript" | "zig" {
  return value === "typescript" ? "typescript" : "zig";
}

const host = globalThis as typeof globalThis & {
  __TURNOUT_SCENE_RUNNER_ENGINE__?: string;
  process?: { env?: Record<string, string | undefined> };
};
const environment = host.process?.env;

export const defaultInternalEngineSelection: InternalEngineSelection =
  requestedDefaultEngine(
    environment?.TURNOUT_SCENE_RUNNER_ENGINE ?? host.__TURNOUT_SCENE_RUNNER_ENGINE__,
  ) === "typescript"
    ? { kind: "typescript" }
    : { kind: "zig", client: (await import("./default-client.js")).defaultZigRuntimeClient };

export function selectInternalEngine<T>(
  selection: InternalEngineSelection,
  createTypeScript: () => T,
  createZig: (client: ZigRuntimeLifecycleTransport) => T,
): T {
  switch (selection.kind) {
    case "typescript":
      return createTypeScript();
    case "zig":
      return createZig(selection.client);
  }
}
