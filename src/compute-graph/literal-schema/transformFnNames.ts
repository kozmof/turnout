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
  tfNull,
  TransformFnNullNames,
  TransformFnNullNameSpace,
} from '../../state-control/preset-funcs/null/transformFn';
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

const transformFnNullNames = (): LiteralSchema<
  TransformFnNullNames,
  undefined
>[] => {
  const namespace: TransformFnNullNameSpace = 'transformFnNull';
  const fnNames = TOM.keys(tfNull);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

export const transformFnNames = () => {
  return union([
    ...transformFnArrayNames(),
    ...transformFnNumberNames(),
    ...transformFnNullNames(),
    ...transformFnStringNames(),
  ]);
};
