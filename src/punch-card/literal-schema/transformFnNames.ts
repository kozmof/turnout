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

const transformFnArrayNames = (): LiteralSchema<
  TransformFnArrayNames,
  undefined
>[] => {
  const nameSpace: TransformFnArrayNameSpace = 'transformFnArray';
  const fnNames = TOM.keys(tfArray);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

const transformFnNumberNames = (): LiteralSchema<
  TransformFnNumberNames,
  undefined
>[] => {
  const nameSpace: TransformFnNumberNameSpace = 'transformFnNumber';
  const fnNames = TOM.keys(tfNumber);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

const transformFnStringNames = (): LiteralSchema<
  TransformFnStringNames,
  undefined
>[] => {
  const nameSpace: TransformFnStringNameSpace = 'transformFnString';
  const fnNames = TOM.keys(tfString);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

export const transformFnNames = () => {
  return union([
    ...transformFnArrayNames(),
    ...transformFnNumberNames(),
    ...transformFnStringNames(),
  ]);
};
