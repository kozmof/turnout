import { literal, LiteralSchema, union } from 'valibot';
import {
  bfArray,
  BinaryFnArrayNames,
  BinaryFnArrayNameSpace,
} from '../../state-control/preset-funcs/array/binaryFn';
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

const binaryFnArrayNames = (): LiteralSchema<
  BinaryFnArrayNames,
  undefined
>[] => {
  const nameSpace: BinaryFnArrayNameSpace = 'binaryFnArray';
  const fnNames = TOM.keys(bfArray);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

const binaryFnGenericNames = (): LiteralSchema<
  BinaryFnGenericNames,
  undefined
>[] => {
  const nameSpace: BinaryFnGenericNameSpace = 'binaryFnGeneric';
  const fnNames = TOM.keys(bfGeneric);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

const binaryFnNumberNames = (): LiteralSchema<
  BinaryFnNumberNames,
  undefined
>[] => {
  const nameSpace: BinaryFnNumberNameSpace = 'binaryFnNumber';
  const fnNames = TOM.keys(bfNumber);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

const binaryFnStringNames = (): LiteralSchema<
  BinaryFnStringNames,
  undefined
>[] => {
  const nameSpace: BinaryFnStringNameSpace = 'binaryFnString';
  const fnNames = TOM.keys(bfString);
  return fnNames.map((fnName) => literal(`${nameSpace}::${fnName}`));
};

export const binaryFnNames = () => {
  return union([
    ...binaryFnArrayNames(),
    ...binaryFnGenericNames(),
    ...binaryFnNumberNames(),
    ...binaryFnStringNames(),
  ]);
};
