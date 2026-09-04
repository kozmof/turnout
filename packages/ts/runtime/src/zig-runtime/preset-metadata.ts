import type { BaseTypeSymbol } from "../state-control/value.js";
import { defaultZigRuntimeClient } from "./default-client.js";

type PresetMetadata = {
  inputType: BaseTypeSymbol | null;
  parameterType: BaseTypeSymbol | null;
  returnType: BaseTypeSymbol | null;
  /** Number of arguments the function consumes; null when the name is unknown. */
  arity: number | null;
};

export function getPresetMetadata(name: string, elementType?: BaseTypeSymbol): PresetMetadata {
  const response = defaultZigRuntimeClient.value<PresetMetadata>({
    operation: "metadata",
    name,
    ...(elementType !== undefined && { elementType }),
  });
  if (response.status !== "ok") {
    return { inputType: null, parameterType: null, returnType: null, arity: null };
  }
  return response.payload;
}

/** Argument names a combine function binds, in order, as Zig reports its arity. */
export function getCombineArgNames(name: string): readonly string[] {
  const arity = getPresetMetadata(name).arity;
  // An unknown name has no arity. Fall back to the two-argument shape, which is
  // what every combine but record::set uses; unknown names are rejected later.
  if (typeof arity !== "number") return COMBINE_ARG_NAMES.slice(0, 2);
  return COMBINE_ARG_NAMES.slice(0, arity);
}

const COMBINE_ARG_NAMES = ["a", "b", "c"] as const;

type GraphInferenceQuery = "value" | "element" | "combine" | "function";

export function inferGraphType(
  query: GraphInferenceQuery,
  id: string,
  context: unknown,
): BaseTypeSymbol | null {
  const response = defaultZigRuntimeClient.value<{ type: BaseTypeSymbol | null }>({
    operation: "infer",
    query,
    id,
    context,
  });
  return response.status === "ok" ? response.payload.type : null;
}

/**
 * Infers the return type of many functions against one context in a single
 * call. Zig returns the types positionally, matching the order of `ids`.
 */
export function inferGraphFunctionTypes(
  ids: readonly string[],
  context: unknown,
): (BaseTypeSymbol | null)[] {
  if (ids.length === 0) return [];
  const response = defaultZigRuntimeClient.value<{ types: (BaseTypeSymbol | null)[] }>({
    operation: "infer",
    query: "functions",
    ids,
    context,
  });
  if (response.status !== "ok") return ids.map(() => null);
  return ids.map((_, index) => response.payload.types[index] ?? null);
}

export function getPassTransformName(type: BaseTypeSymbol): string | null {
  const response = defaultZigRuntimeClient.value<{ name: string | null }>({
    operation: "passTransform",
    type,
  });
  return response.status === "ok" ? response.payload.name : null;
}
