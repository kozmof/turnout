import { createZigPresetNamespace } from "../zig-preset.js";
import { type BooleanToBoolean } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnBoolean {
  and: BooleanToBoolean;
  or: BooleanToBoolean;
  xor: BooleanToBoolean;
}

export const cfBoolean = createZigPresetNamespace<CombineFnBoolean>("combineFnBoolean", [
  "and",
  "or",
  "xor",
]);

export type CombineFnBooleanNameSpace = "combineFnBoolean";
export type CombineFnBooleanNames =
  `${CombineFnBooleanNameSpace}${NamespaceDelimiter}${keyof typeof cfBoolean}`;

export type ReturnMetaCombineFnBoolean = {
  [K in keyof CombineFnBoolean]: ReturnType<CombineFnBoolean[K]>["symbol"];
};

export type ParamsMetaCombineFnBoolean = {
  [K in keyof CombineFnBoolean]: [
    Parameters<CombineFnBoolean[K]>[0]["symbol"],
    Parameters<CombineFnBoolean[K]>[1]["symbol"],
  ];
};
