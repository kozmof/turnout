import { createZigPresetNamespace } from "../zig-preset.js";
import { type NumberValue, type StringValue, type TagSymbol } from "../../value.js";
import { type StringToBoolean, type StringToString } from "../convert.js";
import { type NamespaceDelimiter } from "../../../util/constants.js";

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

export const cfString = createZigPresetNamespace<CombineFnString>("combineFnString", [
  "concat",
  "includes",
  "startsWith",
  "endsWith",
  "extract",
  "extractNum",
]);

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
