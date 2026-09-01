import { describe, expect, it, vi } from "vitest";
import { defaultInternalEngineSelection, selectInternalEngine } from "./engine-selection.js";

describe("selectInternalEngine", () => {
  it("fixes the production selection to Zig", () => {
    expect(defaultInternalEngineSelection.kind).toBe("zig");
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
