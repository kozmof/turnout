import type { ZigRuntimeLifecycleTransport } from "./runner-adapter.js";

export type InternalEngineSelection =
  | { kind: "typescript" }
  | { kind: "zig"; client: ZigRuntimeLifecycleTransport };

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
