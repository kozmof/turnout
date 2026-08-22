import { type BooleanValue, type TagSymbol } from "../../value.js";
import { type BooleanToBoolean } from "../convert.js";
import { combineBooleanOp } from "../../value-builders.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

export interface CombineFnBoolean {
  and: BooleanToBoolean;
  or: BooleanToBoolean;
  xor: BooleanToBoolean;
}

export const cfBoolean: CombineFnBoolean = {
  and: (
    a: BooleanValue<readonly TagSymbol[]>,
    b: BooleanValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x && y, a, b);
  },
  or: (
    a: BooleanValue<readonly TagSymbol[]>,
    b: BooleanValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x || y, a, b);
  },
  xor: (
    a: BooleanValue<readonly TagSymbol[]>,
    b: BooleanValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x !== y, a, b);
  },
} as const;

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
