import { createZigPresetNamespace } from "../zig-preset.js";
import { type NumberToBoolean, type NumberToNumber } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnNumber {
  add: NumberToNumber;
  minus: NumberToNumber;
  multiply: NumberToNumber;
  divide: NumberToNumber;
  mod: NumberToNumber;
  max: NumberToNumber;
  min: NumberToNumber;
  greaterThan: NumberToBoolean;
  greaterThanOrEqual: NumberToBoolean;
  lessThan: NumberToBoolean;
  lessThanOrEqual: NumberToBoolean;
}

export const cfNumber = createZigPresetNamespace<CombineFnNumber>("combineFnNumber", [
  "add",
  "minus",
  "multiply",
  "divide",
  "mod",
  "max",
  "min",
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);

export type CombineFnNumberNameSpace = "combineFnNumber";
export type CombineFnNumberNames =
  `${CombineFnNumberNameSpace}${NamespaceDelimiter}${keyof typeof cfNumber}`;

export type ReturnMetaCombineFnNumber = {
  [K in keyof CombineFnNumber]: ReturnType<CombineFnNumber[K]>["symbol"];
};

export type ParamsMetaCombineFnNumber = {
  [K in keyof CombineFnNumber]: [
    Parameters<CombineFnNumber[K]>[0]["symbol"],
    Parameters<CombineFnNumber[K]>[1]["symbol"],
  ];
};
