import { type ParamsMetaCombineFnBoolean } from "../../preset-funcs/boolean/combineFn.js";
import { type ParamsMetaCombineFnNumber } from "../../preset-funcs/number/combineFn.js";
import { type ParamsMetaCombineFnString } from "../../preset-funcs/string/combineFn.js";

type ParamTypesCombineFnBoolean = ParamsMetaCombineFnBoolean;
type ParamTypesCombineFnNumber = ParamsMetaCombineFnNumber;
type ParamTypesCombineFnString = ParamsMetaCombineFnString;

export const metaCfBooleanParams = (): ParamTypesCombineFnBoolean => {
  return {
    and: ["boolean", "boolean"],
    or: ["boolean", "boolean"],
    xor: ["boolean", "boolean"],
  };
};

export const metaCfNumberParams = (): ParamTypesCombineFnNumber => {
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

export const metaCfStringParams = (): ParamTypesCombineFnString => {
  return {
    concat: ["string", "string"],
    includes: ["string", "string"],
    startsWith: ["string", "string"],
    endsWith: ["string", "string"],
    extract: ["string", "string"],
    extractNum: ["string", "string"],
  };
};
