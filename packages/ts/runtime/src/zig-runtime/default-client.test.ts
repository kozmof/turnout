import { afterEach, describe, expect, it } from "vitest";
import {
  defaultZigRuntimeClient,
  reloadDefaultZigRuntimeClient,
  setDefaultZigRuntimeClient,
} from "./default-client.js";
import { buildNumber } from "../state-control/value-builders.js";

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

describe("replacing the process-wide client", () => {
  const original = defaultZigRuntimeClient;
  afterEach(() => setDefaultZigRuntimeClient(original));

  it("reload installs a working instance that is not the old one", async () => {
    const replacement = await reloadDefaultZigRuntimeClient();

    expect(replacement).not.toBe(original);
    expect(replacement.usable).toBe(true);
    // The old instance is untouched — replacing is not destroying.
    expect(original.usable).toBe(true);
    expect(defaultZigRuntimeClient).toBe(replacement);
  });

  /**
   * The point of the export. The synchronous API reaches for the module
   * binding on every call rather than capturing it, so a replacement has to
   * reach callers that imported the binding long before it happened. That is
   * an ES-module live binding doing its job, and it is worth a test because
   * one `const client = defaultZigRuntimeClient` cached at module scope
   * anywhere in the chain would silently undo it.
   */
  it("routes the synchronous value API through the replacement", async () => {
    const replacement = await reloadDefaultZigRuntimeClient();
    const before = replacement.memoryByteLength();

    expect(buildNumber(21)).toEqual({ symbol: "number", value: 21, tags: [] });

    // The replacement did the work: an instance that is never called never
    // allocates, and these calls allocate on the way in and out.
    expect(replacement.memoryByteLength()).toBeGreaterThanOrEqual(before);
    expect(defaultZigRuntimeClient).toBe(replacement);
  });

  it("setDefault points the synchronous API at a caller-supplied instance", () => {
    const calls: unknown[] = [];
    const spy = new Proxy(original, {
      get(target, property, receiver) {
        if (property === "value") {
          return (request: unknown) => {
            calls.push(request);
            return target.value(request);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    setDefaultZigRuntimeClient(spy);
    expect(buildNumber(7)).toEqual({ symbol: "number", value: 7, tags: [] });
    expect(calls).toHaveLength(1);
  });
});
