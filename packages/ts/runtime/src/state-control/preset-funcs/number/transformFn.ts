import { createZigPresetNamespace } from "../zig-preset.js";
import { type NumberValue, type TagSymbol } from "../../value.js";
import { type ToNumberConversion, type ToStringConversion } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnNumber {
  pass: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  toStr: ToStringConversion<NumberValue<readonly TagSymbol[]>>;
  abs: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  floor: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  ceil: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  round: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
  negate: ToNumberConversion<NumberValue<readonly TagSymbol[]>>;
}

export const tfNumber = createZigPresetNamespace<TransformFnNumber>("transformFnNumber", [
  "pass",
  "toStr",
  "abs",
  "floor",
  "ceil",
  "round",
  "negate",
]);

export type TransformFnNumberNameSpace = "transformFnNumber";
export type TransformFnNumberNames =
  `${TransformFnNumberNameSpace}${NamespaceDelimiter}${keyof typeof tfNumber}`;

export type ReturnMetaTransformFnNumber = {
  [K in keyof TransformFnNumber]: ReturnType<TransformFnNumber[K]>["symbol"];
};
