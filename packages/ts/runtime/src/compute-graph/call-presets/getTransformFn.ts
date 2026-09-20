import type { AnyValue } from "../../state-control/value.js";
import { defaultZigRuntimeClient } from "../../zig-runtime/default-client.js";
import { fromCanonicalValue, toCanonicalOperationValue } from "../../zig-runtime/value-codec.js";
import type { TransformFnNames } from "../types.js";

type AnyToAny = (value: AnyValue) => AnyValue;

export const getTransformFn = (name: TransformFnNames): AnyToAny => {
  assertKnownPreset(name);
  return (value) => {
    const response = defaultZigRuntimeClient.value({
      operation: "preset",
      name,
      args: [toCanonicalOperationValue(value)],
    });
    if (response.status !== "ok") throw new Error(readError(response.payload));
    const result = fromCanonicalValue(response.payload);
    // `pass` is the identity, and the engine implements it as one. Returning the
    // argument rather than the value that came back is not a second
    // implementation of it: it is the one thing a round trip through WASM
    // cannot preserve, because decoding always builds a fresh object. Callers
    // rely on `pass` handing back the very value they passed — see the `toBe`
    // assertions in preset-funcs.test.ts and call-presets.test.ts — and
    // reference identity is a property of the host language, not of the engine.
    return name.endsWith("::pass") ? value : result;
  };
};

function assertKnownPreset(name: string): void {
  const response = defaultZigRuntimeClient.value({ operation: "preset", name, args: [] });
  if (readError(response.payload) === "UnknownFunction") {
    throw new Error(`Invalid transform function name: ${name}`);
  }
}

function readError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    return String((payload as { error: unknown }).error);
  }
  return "Zig preset execution failed";
}
