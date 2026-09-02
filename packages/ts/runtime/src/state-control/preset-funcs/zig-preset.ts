import type { AnyValue } from "../value.js";
import { defaultZigRuntimeClient } from "../../zig-runtime/default-client.js";
import { fromCanonicalValue, toCanonicalOperationValue } from "../../zig-runtime/value-codec.js";

type PresetTable = object;

export function createZigPresetNamespace<T extends PresetTable>(
  namespace: string,
  names: readonly string[],
): T {
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property !== "string") return undefined;
        return (...args: AnyValue[]) => callZigPreset(`${namespace}::${property}`, args);
      },
      ownKeys: () => [...names],
      getOwnPropertyDescriptor: (_target, property) =>
        typeof property === "string" && names.includes(property)
          ? { configurable: true, enumerable: true }
          : undefined,
    },
  ) as T;
}

function callZigPreset(name: string, args: readonly AnyValue[]): AnyValue {
  const response = defaultZigRuntimeClient.value({
    operation: "preset",
    name,
    args: args.map(toCanonicalOperationValue),
  });
  if (response.status !== "ok") throw compatibilityError(name, args, response.payload);
  const result = fromCanonicalValue(response.payload);
  return name.endsWith("::pass") ? (args[0] ?? result) : result;
}

function compatibilityError(name: string, args: readonly AnyValue[], payload: unknown): Error {
  const code = readError(payload);
  if (code === "DivisionByZero") return new Error("Division by zero");
  if (code === "ModuloByZero") return new Error("Modulo by zero");
  if (code === "InvalidNumber") {
    return new Error(`Cannot convert ${JSON.stringify(args[0]?.value)} to a number`);
  }
  if (code === "IndexOutOfBounds") {
    return new Error(`Array index ${String(args[1]?.value)} is out of bounds`);
  }
  if (code === "IncomparableValues") {
    const comparison = name.endsWith("isNotEqual") ? "inequality" : "equality";
    return new Error(
      `Cannot compare ${String(args[0]?.symbol)} and ${String(args[1]?.symbol)} values for ${comparison}`,
    );
  }
  return new Error(code);
}

function readError(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    return String((payload as { error: unknown }).error);
  }
  return "Zig preset execution failed";
}
