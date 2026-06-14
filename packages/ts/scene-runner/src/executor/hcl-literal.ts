import { buildArray } from "runtime";
import type { AnyValue } from "runtime";
import { SceneRuntimeError } from "./errors.js";
import { literalToValue, protoValueToJs } from "../state/state-manager.js";

export function inferLiteralAnyValue(lit: unknown, contextId: string): AnyValue {
  const v = protoValueToJs(lit);
  if (typeof v === "number") return literalToValue(v, "number");
  if (typeof v === "string") return literalToValue(v, "str");
  if (typeof v === "boolean") return literalToValue(v, "bool");
  if (Array.isArray(v)) {
    // An empty array is acceptable here: the Go validator rejects [] as a
    // function argument (CodeEmptyArrayLitArg), so this path only fires for
    // value bindings whose type is already known to the runtime from the schema.
    if (v.length === 0) return buildArray([]);
    const first = v[0];
    const firstType = typeof first;
    if (!v.every((e) => typeof e === firstType)) {
      throw new SceneRuntimeError(
        "UnknownArgModel",
        contextId,
        `heterogeneous array literal — all elements must share one JS type (first element is ${firstType})`,
      );
    }
    if (firstType === "number") return literalToValue(v, "arr<number>");
    if (firstType === "string") return literalToValue(v, "arr<str>");
    if (firstType === "boolean") return literalToValue(v, "arr<bool>");
  }
  throw new SceneRuntimeError(
    "UnknownArgModel",
    contextId,
    `unrecognized protobuf value kind for inline literal: ${typeof v}`,
  );
}
