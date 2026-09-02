import { createZigPresetNamespace } from "../zig-preset.js";
import { type AnyArrayValue, type TagSymbol } from "../../value.js";
import {
  type ToArrayConversion,
  type ToNumberConversion,
  type ToBooleanConversion,
} from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnArray {
  pass: ToArrayConversion<AnyArrayValue<readonly TagSymbol[]>>;
  length: ToNumberConversion<AnyArrayValue<readonly TagSymbol[]>>;
  isEmpty: ToBooleanConversion<AnyArrayValue<readonly TagSymbol[]>>;
}

export const tfArray = createZigPresetNamespace<TransformFnArray>("transformFnArray", [
  "pass",
  "length",
  "isEmpty",
]);

export type TransformFnArrayNameSpace = "transformFnArray";
export type TransformFnArrayNames =
  `${TransformFnArrayNameSpace}${NamespaceDelimiter}${keyof typeof tfArray}`;

export type ReturnMetaTransformFnArray = {
  [K in keyof TransformFnArray]: ReturnType<TransformFnArray[K]>["symbol"];
};
