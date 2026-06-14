import { type ParamsMetaBinaryFnBoolean } from "../../preset-funcs/boolean/binaryFn.js";
import { type ParamsMetaBinaryFnGeneric } from "../../preset-funcs/generic/binaryFn.js";
import { type ParamsMetaBinaryFnNumber } from "../../preset-funcs/number/binaryFn.js";
import { type ParamsMetaBinaryFnString } from "../../preset-funcs/string/binaryFn.js";
import { type BaseTypeSymbol } from "../../value.js";

type ParamTypesBinaryFnBoolean = ParamsMetaBinaryFnBoolean;
type ParamTypesBinaryFnNumber = ParamsMetaBinaryFnNumber;
type ParamTypesBinaryFnString = ParamsMetaBinaryFnString;
type ParamTypesBinaryFnGeneric = ParamsMetaBinaryFnGeneric;

export const metaBfBooleanParams = (): ParamTypesBinaryFnBoolean => {
  return {
    and: ["boolean", "boolean"],
    or: ["boolean", "boolean"],
    xor: ["boolean", "boolean"],
  };
};

export const metaBfNumberParams = (): ParamTypesBinaryFnNumber => {
  return {
    add: ["number", "number"],
    minus: ["number", "number"],
    multiply: ["number", "number"],
    divide: ["number", "number"],
    mod: ["number", "number"],
    max: ["number", "number"],
    min: ["number", "number"],
    greaterThan: ["number", "number"],
    greaterThanOrEqual: ["number", "number"],
    lessThan: ["number", "number"],
    lessThanOrEqual: ["number", "number"],
  };
};

export const metaBfStringParams = (): ParamTypesBinaryFnString => {
  return {
    concat: ["string", "string"],
    includes: ["string", "string"],
    startsWith: ["string", "string"],
    endsWith: ["string", "string"],
  };
};

export const metaBfGenericParams = (symbol: BaseTypeSymbol): ParamTypesBinaryFnGeneric => {
  return {
    isEqual: [symbol, symbol],
    isNotEqual: [symbol, symbol],
  };
};
