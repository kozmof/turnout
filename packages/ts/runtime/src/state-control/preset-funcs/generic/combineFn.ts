import { createZigPresetNamespace } from "../zig-preset.js";
import { type AnyValue } from "../../value.js";
import { type ToBooleanProcess } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnGeneric<T extends AnyValue> {
  isEqual: ToBooleanProcess<T, T>;
  isNotEqual: ToBooleanProcess<T, T>;
}

export const cfGeneric = createZigPresetNamespace<CombineFnGeneric<AnyValue>>("combineFnGeneric", [
  "isEqual",
  "isNotEqual",
]);

export type CombineFnGenericNameSpace = "combineFnGeneric";
export type CombineFnGenericNames =
  `${CombineFnGenericNameSpace}${NamespaceDelimiter}${keyof typeof cfGeneric}`;

export type ReturnMetaCombineFnGeneric = {
  [K in keyof CombineFnGeneric<AnyValue>]: ReturnType<CombineFnGeneric<AnyValue>[K]>["symbol"];
};
