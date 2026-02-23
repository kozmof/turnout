import { literal, LiteralSchema, union } from 'valibot';
import {
  bfArray,
  BinaryFnArrayNames,
  BinaryFnArrayNameSpace,
} from '../../state-control/preset-funcs/array/binaryFn';
import {
  bfBoolean,
  BinaryFnBooleanNames,
  BinaryFnBooleanNameSpace,
} from '../../state-control/preset-funcs/boolean/binaryFn';
import { TOM } from '../../util/tom';
import {
  bfGeneric,
  BinaryFnGenericNames,
  BinaryFnGenericNameSpace,
} from '../../state-control/preset-funcs/generic/binaryFn';
import {
  bfNumber,
  BinaryFnNumberNames,
  BinaryFnNumberNameSpace,
} from '../../state-control/preset-funcs/number/binaryFn';
import {
  bfString,
  BinaryFnStringNames,
  BinaryFnStringNameSpace,
} from '../../state-control/preset-funcs/string/binaryFn';
import { NAMESPACE_DELIMITER } from '../../util/constants';

const binaryFnArrayNames = (): LiteralSchema<
  BinaryFnArrayNames,
  undefined
>[] => {
  const namespace: BinaryFnArrayNameSpace = 'binaryFnArray';
  const fnNames = TOM.keys(bfArray);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const binaryFnGenericNames = (): LiteralSchema<
  BinaryFnGenericNames,
  undefined
>[] => {
  const namespace: BinaryFnGenericNameSpace = 'binaryFnGeneric';
  const fnNames = TOM.keys(bfGeneric);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const binaryFnBooleanNames = (): LiteralSchema<
  BinaryFnBooleanNames,
  undefined
>[] => {
  const namespace: BinaryFnBooleanNameSpace = 'binaryFnBoolean';
  const fnNames = TOM.keys(bfBoolean);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const binaryFnNumberNames = (): LiteralSchema<
  BinaryFnNumberNames,
  undefined
>[] => {
  const namespace: BinaryFnNumberNameSpace = 'binaryFnNumber';
  const fnNames = TOM.keys(bfNumber);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

const binaryFnStringNames = (): LiteralSchema<
  BinaryFnStringNames,
  undefined
>[] => {
  const namespace: BinaryFnStringNameSpace = 'binaryFnString';
  const fnNames = TOM.keys(bfString);
  return fnNames.map((fnName) => literal(`${namespace}${NAMESPACE_DELIMITER}${fnName}`));
};

export const binaryFnNames = () => {
  return union([
    ...binaryFnArrayNames(),
    ...binaryFnBooleanNames(),
    ...binaryFnGenericNames(),
    ...binaryFnNumberNames(),
    ...binaryFnStringNames(),
  ]);
};
