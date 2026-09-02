import { createZigPresetNamespace } from "../zig-preset.js";
import { type StringValue, type TagSymbol } from "../../value.js";
import { type ToStringConversion, type ToNumberConversion } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnString {
  pass: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toNumber: ToNumberConversion<StringValue<readonly TagSymbol[]>>;
  trim: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toLowerCase: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  toUpperCase: ToStringConversion<StringValue<readonly TagSymbol[]>>;
  length: ToNumberConversion<StringValue<readonly TagSymbol[]>>;
}

export const tfString = createZigPresetNamespace<TransformFnString>("transformFnString", [
  "pass",
  "toNumber",
  "trim",
  "toLowerCase",
  "toUpperCase",
  "length",
]);

export type TransformFnStringNameSpace = "transformFnString";
export type TransformFnStringNames =
  `${TransformFnStringNameSpace}${NamespaceDelimiter}${keyof typeof tfString}`;

export type ReturnMetaTransformFnString = {
  [K in keyof TransformFnString]: ReturnType<TransformFnString[K]>["symbol"];
};
