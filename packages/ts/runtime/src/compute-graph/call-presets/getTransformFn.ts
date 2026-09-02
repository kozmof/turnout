import type { AnyValue } from "../../state-control/value.js";
import { defaultZigRuntimeClient } from "../../zig-runtime/default-client.js";
import { fromCanonicalValue, toCanonicalValue } from "../../zig-runtime/value-codec.js";
import type { TransformFnNames } from "../types.js";

type AnyToAny = (value: AnyValue) => AnyValue;

export const getTransformFn = (name: TransformFnNames): AnyToAny => {
  assertKnownPreset(name);
  return (value) => {
    const response = defaultZigRuntimeClient.value({
      operation: "preset",
      name,
      args: [toCanonicalValue(value)],
    });
    if (response.status !== "ok") throw new Error(readError(response.payload));
    const result = fromCanonicalValue(response.payload);
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
