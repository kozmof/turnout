import { type BooleanValue, type NumberValue, type TagSymbol } from "../../value.js";
import { type NumberToBoolean, type NumberToNumber } from "../convert.js";
import { combineBooleanOp, combineNumberOp } from "../../value-builders.js";
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

export const cfNumber: CombineFnNumber = {
  add: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    return combineNumberOp((x, y) => x + y, a, b);
  },
  minus: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    return combineNumberOp((x, y) => x - y, a, b);
  },
  multiply: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    return combineNumberOp((x, y) => x * y, a, b);
  },
  divide: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    if (b.value === 0) {
      throw new Error("Division by zero");
    }
    return combineNumberOp((x, y) => x / y, a, b);
  },
  mod: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    if (b.value === 0) {
      throw new Error("Modulo by zero");
    }
    return combineNumberOp((x, y) => x % y, a, b);
  },
  max: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    return combineNumberOp((x, y) => Math.max(x, y), a, b);
  },
  min: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    return combineNumberOp((x, y) => Math.min(x, y), a, b);
  },
  greaterThan: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x > y, a, b);
  },
  greaterThanOrEqual: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x >= y, a, b);
  },
  lessThan: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x < y, a, b);
  },
  lessThanOrEqual: (
    a: NumberValue<readonly TagSymbol[]>,
    b: NumberValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x <= y, a, b);
  },
} as const;

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
