import { describe, expect, it } from "vitest";
import { defaultZigRuntimeClient } from "./default-client.js";

describe("packaged Zig runtime client", () => {
  it("normalizes Values and executes presets synchronously after module initialization", () => {
    expect(
      defaultZigRuntimeClient.value({
        operation: "normalize",
        value: { symbol: "null", value: null, reason: "not-found", tags: ["a", "a"] },
      }),
    ).toEqual({
      status: "ok",
      payload: { symbol: "null", value: null, reason: "not-found", tags: ["a"] },
    });
    expect(
      defaultZigRuntimeClient.value({
        operation: "preset",
        name: "combineFnNumber::add",
        args: [
          { symbol: "number", value: 2, tags: ["left"] },
          { symbol: "number", value: 3, tags: ["right"] },
        ],
      }),
    ).toEqual({
      status: "ok",
      payload: { symbol: "number", value: 5, tags: ["left", "right"] },
    });
  });
});
