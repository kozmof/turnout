import { literal, LiteralSchema, union } from "valibot";
import {
  cfArray,
  cfRecord,
  CombineFnArrayNames,
  CombineFnArrayNameSpace,
  CombineFnRecordNames,
} from "../../state-control/preset-funcs/array/combineFn.js";
import {
  cfBoolean,
  CombineFnBooleanNames,
  CombineFnBooleanNameSpace,
} from "../../state-control/preset-funcs/boolean/combineFn.js";
import { TOM } from "../../util/tom.js";
import {
  cfGeneric,
  CombineFnGenericNames,
  CombineFnGenericNameSpace,
} from "../../state-control/preset-funcs/generic/combineFn.js";
import {
  cfNumber,
  CombineFnNumberNames,
  CombineFnNumberNameSpace,
} from "../../state-control/preset-funcs/number/combineFn.js";
import {
  cfString,
  CombineFnStringNames,
  CombineFnStringNameSpace,
} from "../../state-control/preset-funcs/string/combineFn.js";
import { NAMESPACE_DELIMITER } from "../../util/constants.js";

const combineFnArrayNames = (): LiteralSchema<CombineFnArrayNames, undefined>[] => {
  const namespace: CombineFnArrayNameSpace = "combineFnArray";
  const fnNames = TOM.keys(cfArray);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const combineFnRecordNames = (): LiteralSchema<CombineFnRecordNames, undefined>[] => {
  return TOM.keys(cfRecord).map((fnName) =>
    literal(("combineFnRecord::" + fnName) as CombineFnRecordNames),
  );
};

const combineFnGenericNames = (): LiteralSchema<CombineFnGenericNames, undefined>[] => {
  const namespace: CombineFnGenericNameSpace = "combineFnGeneric";
  const fnNames = TOM.keys(cfGeneric);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const combineFnBooleanNames = (): LiteralSchema<CombineFnBooleanNames, undefined>[] => {
  const namespace: CombineFnBooleanNameSpace = "combineFnBoolean";
  const fnNames = TOM.keys(cfBoolean);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const combineFnNumberNames = (): LiteralSchema<CombineFnNumberNames, undefined>[] => {
  const namespace: CombineFnNumberNameSpace = "combineFnNumber";
  const fnNames = TOM.keys(cfNumber);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const combineFnStringNames = (): LiteralSchema<CombineFnStringNames, undefined>[] => {
  const namespace: CombineFnStringNameSpace = "combineFnString";
  const fnNames = TOM.keys(cfString);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

export const combineFnNames = () => {
  return union([
    ...combineFnArrayNames(),
    ...combineFnRecordNames(),
    ...combineFnBooleanNames(),
    ...combineFnGenericNames(),
    ...combineFnNumberNames(),
    ...combineFnStringNames(),
  ]);
};
