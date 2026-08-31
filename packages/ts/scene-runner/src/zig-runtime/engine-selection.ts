export type InternalEngineSelection<T> = { kind: "typescript" } | { kind: "zig"; create: () => T };

export function selectInternalEngine<T>(
  selection: InternalEngineSelection<T>,
  createTypeScript: () => T,
): T {
  switch (selection.kind) {
    case "typescript":
      return createTypeScript();
    case "zig":
      return selection.create();
  }
}
