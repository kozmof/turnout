import { createZigPresetNamespace } from "../zig-preset.js";
import { type NullValue, type TagSymbol } from "../../value.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface TransformFnNull {
  pass: (val: NullValue<readonly TagSymbol[]>) => NullValue<readonly TagSymbol[]>;
}

export const tfNull = createZigPresetNamespace<TransformFnNull>("transformFnNull", ["pass"]);

export type TransformFnNullNameSpace = "transformFnNull";
export type TransformFnNullNames =
  `${TransformFnNullNameSpace}${NamespaceDelimiter}${keyof typeof tfNull}`;

export type ReturnMetaTransformFnNull = {
  [K in keyof TransformFnNull]: ReturnType<TransformFnNull[K]>["symbol"];
};
