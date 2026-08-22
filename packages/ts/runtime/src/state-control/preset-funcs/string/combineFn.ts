import {
  type BooleanValue,
  type NumberValue,
  type StringValue,
  type TagSymbol,
} from "../../value.js";
import { type StringToBoolean, type StringToString } from "../convert.js";
import { combineBooleanOp, combineStringOp, buildNumber } from "../../value-builders.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";
import { extractCapture } from "./templateExtract.js";

export interface CombineFnString {
  concat: StringToString;
  includes: StringToBoolean;
  startsWith: StringToBoolean;
  endsWith: StringToBoolean;
  // extract(subject, spec) reads a template capture (literal-template-types-spec.md §19). `subject` is
  // the template value; `spec` is a JSON descriptor of the resolved template and
  // the capture to read. Returns the raw captured substring.
  extract: StringToString;
  // extractNum is extract for numeric captures: it returns the parsed number.
  extractNum: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ) => NumberValue<readonly TagSymbol[]>;
}

export const cfString: CombineFnString = {
  concat: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): StringValue<readonly TagSymbol[]> => {
    return combineStringOp((x, y) => x + y, a, b);
  },
  includes: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x.includes(y), a, b);
  },
  startsWith: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x.startsWith(y), a, b);
  },
  endsWith: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): BooleanValue<readonly TagSymbol[]> => {
    return combineBooleanOp((x, y) => x.endsWith(y), a, b);
  },
  extract: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): StringValue<readonly TagSymbol[]> => {
    return combineStringOp((subject, spec) => extractCapture(subject, spec), a, b);
  },
  extractNum: (
    a: StringValue<readonly TagSymbol[]>,
    b: StringValue<readonly TagSymbol[]>,
  ): NumberValue<readonly TagSymbol[]> => {
    const raw = extractCapture(a.value, b.value);
    const n = Number(raw);
    return buildNumber(raw !== "" && !Number.isNaN(n) ? n : 0, a.tags);
  },
} as const;

export type CombineFnStringNameSpace = "combineFnString";
export type CombineFnStringNames =
  `${CombineFnStringNameSpace}${NamespaceDelimiter}${keyof typeof cfString}`;

export type ReturnMetaCombineFnString = {
  [K in keyof CombineFnString]: ReturnType<CombineFnString[K]>["symbol"];
};

export type ParamsMetaCombineFnString = {
  [K in keyof CombineFnString]: [
    Parameters<CombineFnString[K]>[0]["symbol"],
    Parameters<CombineFnString[K]>[1]["symbol"],
  ];
};
