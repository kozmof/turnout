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

export function callZigPreset(name: string, args: readonly AnyValue[]): AnyValue {
  const response = defaultZigRuntimeClient.value({
    operation: "preset",
    name,
    args: args.map(toCanonicalOperationValue),
  });
  if (response.status !== "ok") throw compatibilityError(name, args, response.payload);
  const result = fromCanonicalValue(response.payload);
  // `pass` is the identity, and the engine implements it as one. Returning the
  // argument rather than the value that came back is not a second
  // implementation of it: it is the one thing a round trip through WASM
  // cannot preserve, because decoding always builds a fresh object. Callers
  // rely on `pass` handing back the very value they passed — see the `toBe`
  // assertions in preset-funcs.test.ts and call-presets.test.ts — and
  // reference identity is a property of the host language, not of the engine.
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
    if (name.startsWith("combineFnRecord::get")) {
      return new Error(`Record key ${JSON.stringify(String(args[1]?.value))} was not found`);
    }
    return new Error(`Array index ${String(args[1]?.value)} is out of bounds`);
  }
  if (code === "TypeMismatch" && name === "combineFnRecord::set") {
    return new Error(
      `Reserved record key ${JSON.stringify(String(args[1]?.value))} is not allowed`,
    );
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
