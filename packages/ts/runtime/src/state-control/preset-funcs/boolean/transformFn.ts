import { createZigPresetNamespace } from "../zig-preset.js";
import { type BooleanValue, type TagSymbol } from "../../value.js";
import { type ToBooleanConversion, type ToStringConversion } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnBoolean {
  pass: ToBooleanConversion<BooleanValue<readonly TagSymbol[]>>;
  not: ToBooleanConversion<BooleanValue<readonly TagSymbol[]>>;
  toStr: ToStringConversion<BooleanValue<readonly TagSymbol[]>>;
}

export const tfBoolean = createZigPresetNamespace<TransformFnBoolean>("transformFnBoolean", [
  "pass",
  "not",
  "toStr",
]);

export type TransformFnBooleanNameSpace = "transformFnBoolean";
export type TransformFnBooleanNames =
  `${TransformFnBooleanNameSpace}${NamespaceDelimiter}${keyof typeof tfBoolean}`;

export type ReturnMetaTransformFnBoolean = {
  [K in keyof TransformFnBoolean]: ReturnType<TransformFnBoolean[K]>["symbol"];
};
