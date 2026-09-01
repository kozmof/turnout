import { describe, expect, it, vi } from "vitest";
import { requestedDefaultEngine, selectInternalEngine } from "./engine-selection.js";

describe("selectInternalEngine", () => {
  it("selects Zig unless the internal rollback value requests TypeScript", () => {
    expect(requestedDefaultEngine(undefined)).toBe("zig");
    expect(requestedDefaultEngine("zig")).toBe("zig");
    expect(requestedDefaultEngine("typescript")).toBe("typescript");
  });
  it("uses TypeScript by default selection without constructing Zig", () => {
    const createTypeScript = vi.fn(() => "typescript");
    const createZig = vi.fn(() => "zig");

    expect(selectInternalEngine({ kind: "typescript" }, createTypeScript, createZig)).toBe(
      "typescript",
    );
    expect(createTypeScript).toHaveBeenCalledOnce();
    expect(createZig).not.toHaveBeenCalled();
  });

  it("uses the injected Zig factory only when selected", () => {
    const createTypeScript = vi.fn(() => "typescript");
    const createZig = vi.fn(() => "zig");

    expect(
      selectInternalEngine({ kind: "zig", client: {} as never }, createTypeScript, createZig),
    ).toBe("zig");
    expect(createZig).toHaveBeenCalledOnce();
    expect(createTypeScript).not.toHaveBeenCalled();
  });
});
