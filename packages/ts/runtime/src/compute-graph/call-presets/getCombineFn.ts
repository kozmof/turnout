import type { AnyValue } from "../../state-control/value.js";
import { defaultZigRuntimeClient } from "../../zig-runtime/default-client.js";
import { fromCanonicalValue, toCanonicalOperationValue } from "../../zig-runtime/value-codec.js";
import type { CombineFnNames } from "../types.js";

type AnyToAny = (...values: AnyValue[]) => AnyValue;

export const getCombineFn = (name: CombineFnNames): AnyToAny => {
  assertKnownPreset(name, "combine");
  return (...values) => callPreset(name, values);
};

function assertKnownPreset(name: string, kind: "combine" | "transform"): void {
  const response = defaultZigRuntimeClient.value({ operation: "preset", name, args: [] });
  if (readError(response.payload) === "UnknownFunction") {
    throw new Error(`Invalid ${kind} function name: ${name}`);
  }
}

function callPreset(name: string, values: readonly AnyValue[]): AnyValue {
  const response = defaultZigRuntimeClient.value({
    operation: "preset",
    name,
    args: values.map(toCanonicalOperationValue),
  });
  if (response.status !== "ok") throw new Error(readError(response.payload));
  return fromCanonicalValue(response.payload);
}

function readError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    return String((payload as { error: unknown }).error);
  }
  return "Zig preset execution failed";
}
