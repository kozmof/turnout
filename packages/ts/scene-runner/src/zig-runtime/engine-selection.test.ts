import { describe, expect, it, vi } from "vitest";
import { selectInternalEngine } from "./engine-selection.js";

describe("selectInternalEngine", () => {
  it("uses TypeScript by default selection without constructing Zig", () => {
    const createTypeScript = vi.fn(() => "typescript");
    const createZig = vi.fn(() => "zig");

    expect(selectInternalEngine({ kind: "typescript" }, createTypeScript)).toBe("typescript");
    expect(createTypeScript).toHaveBeenCalledOnce();
    expect(createZig).not.toHaveBeenCalled();
  });

  it("uses the injected Zig factory only when selected", () => {
    const createTypeScript = vi.fn(() => "typescript");
    const createZig = vi.fn(() => "zig");

    expect(selectInternalEngine({ kind: "zig", create: createZig }, createTypeScript)).toBe("zig");
    expect(createZig).toHaveBeenCalledOnce();
    expect(createTypeScript).not.toHaveBeenCalled();
  });
});
