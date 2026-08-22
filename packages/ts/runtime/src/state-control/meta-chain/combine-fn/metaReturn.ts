import { type ReturnMetaCombineFnArray } from "../../preset-funcs/array/combineFn.js";
import { type ReturnMetaCombineFnBoolean } from "../../preset-funcs/boolean/combineFn.js";
import { type ReturnMetaCombineFnGeneric } from "../../preset-funcs/generic/combineFn.js";
import { type ReturnMetaCombineFnNumber } from "../../preset-funcs/number/combineFn.js";
import { type ReturnMetaCombineFnString } from "../../preset-funcs/string/combineFn.js";
import { type ElemType } from "../types.js";

// No longer need to remove random symbols since tags are tracked separately
export type ReturnTypeCombineFnNumber = ReturnMetaCombineFnNumber;
export type ReturnTypeCombineFnString = ReturnMetaCombineFnString;
export type ReturnTypeCombineFnArray = ReturnMetaCombineFnArray;
export type ReturnTypeCombineFnBoolean = ReturnMetaCombineFnBoolean;
export type ReturnTypeCombineFnGeneric = ReturnMetaCombineFnGeneric;

export const metaCfBoolean = (): ReturnTypeCombineFnBoolean => {
  return {
    and: "boolean",
    or: "boolean",
    xor: "boolean",
  };
};

export const metaCfNumber = (): ReturnTypeCombineFnNumber => {
  return {
    add: "number",
    minus: "number",
    multiply: "number",
    divide: "number",
    mod: "number",
    max: "number",
    min: "number",
    greaterThan: "boolean",
    greaterThanOrEqual: "boolean",
    lessThan: "boolean",
    lessThanOrEqual: "boolean",
  };
};

export const metaCfString = (): ReturnTypeCombineFnString => {
  return {
    concat: "string",
    includes: "boolean",
    startsWith: "boolean",
    endsWith: "boolean",
    extract: "string",
    extractNum: "number",
  };
};

export const metaCfArray = (elemType: ElemType): ReturnTypeCombineFnArray => {
  return {
    includes: "boolean",
    get: elemType,
    concat: "array",
  };
};

export const metaCfGeneric = (): ReturnTypeCombineFnGeneric => {
  return {
    isEqual: "boolean",
    isNotEqual: "boolean",
  };
};
