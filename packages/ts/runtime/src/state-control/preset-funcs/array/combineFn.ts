import { createZigPresetNamespace } from "../zig-preset.js";
import {
  type AnyArrayValue,
  type NonArrayValue,
  type NumberValue,
  type TagSymbol,
  type AnyValue,
} from "../../value.js";
import { type ArrayToArray, type ToBooleanProcess } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnArray {
  includes: ToBooleanProcess<AnyArrayValue<readonly TagSymbol[]>, NonArrayValue>;
  get: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getNumber: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getString: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getBoolean: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getArray: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  getRecord: (
    array: AnyArrayValue<readonly TagSymbol[]>,
    index: NumberValue<readonly TagSymbol[]>,
  ) => AnyValue;
  concat: ArrayToArray;
}

export const cfArray = createZigPresetNamespace<CombineFnArray>("combineFnArray", [
  "includes",
  "get",
  "getNumber",
  "getString",
  "getBoolean",
  "getArray",
  "getRecord",
  "concat",
]);

export type CombineFnArrayNameSpace = "combineFnArray";
export type CombineFnArrayNames =
  `${CombineFnArrayNameSpace}${NamespaceDelimiter}${keyof typeof cfArray}`;

export type ReturnMetaCombineFnArray = {
  [K in keyof CombineFnArray]: ReturnType<CombineFnArray[K]>["symbol"];
};

// `get` is the untyped accessor, and the five `getX` methods are the same
// engine preset under names that say what the caller expects back — the
// compiler emits only the typed spellings, while the authoring API reaches for
// the plain one. `cfArray` exposes both for the same reason; this namespace was
// missing `get` alone, which is what scripts/check-preset-names.mjs now pins.
type CombineFnRecord = Record<
  "get" | "getNumber" | "getString" | "getBoolean" | "getArray" | "getRecord" | "set",
  (...args: AnyValue[]) => AnyValue
>;

export const cfRecord = createZigPresetNamespace<CombineFnRecord>("combineFnRecord", [
  "get",
  "getNumber",
  "getString",
  "getBoolean",
  "getArray",
  "getRecord",
  "set",
]);
export type CombineFnRecordNames =
  | "combineFnRecord::get"
  | "combineFnRecord::getNumber"
  | "combineFnRecord::getString"
  | "combineFnRecord::getBoolean"
  | "combineFnRecord::getArray"
  | "combineFnRecord::getRecord"
  | "combineFnRecord::set";
