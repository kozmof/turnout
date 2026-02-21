import { literal, LiteralSchema, union } from 'valibot';
import {
  tfArray,
  TransformFnArrayNames,
  TransformFnArrayNameSpace,
} from '../../state-control/preset-funcs/array/transformFn';
import { TOM } from '../../util/tom';
import {
  tfNumber,
  TransformFnNumberNames,
  TransformFnNumberNameSpace,
} from '../../state-control/preset-funcs/number/transformFn';
import {
  tfString,
  TransformFnStringNames,
  TransformFnStringNameSpace,
} from '../../state-control/preset-funcs/string/transformFn';
import { NAMESPACE_DELIMITER } from '../../util/constants';

const transformFnArrayNames = (): LiteralSchema<
  TransformFnArrayNames,
  undefined
>[] => {
  const namespace: TransformFnArrayNameSpace = 'transformFnArray';
  const fnNames = TOM.keys(tfArray);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const transformFnNumberNames = (): LiteralSchema<
  TransformFnNumberNames,
  undefined
>[] => {
  const namespace: TransformFnNumberNameSpace = 'transformFnNumber';
  const fnNames = TOM.keys(tfNumber);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const transformFnStringNames = (): LiteralSchema<
  TransformFnStringNames,
  undefined
>[] => {
  const namespace: TransformFnStringNameSpace = 'transformFnString';
  const fnNames = TOM.keys(tfString);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

export const transformFnNames = () => {
  return union([
    ...transformFnArrayNames(),
    ...transformFnNumberNames(),
    ...transformFnStringNames(),
  ]);
};
