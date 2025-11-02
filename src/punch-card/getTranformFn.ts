import { tfArray } from '../state-control/preset-funcs/array/transformFn';
import { tfNumber } from '../state-control/preset-funcs/number/transformFn';
import { tfString } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';
import { splitPairTranformFnNames } from '../util/splitPair';
import { TransformFnNames } from './types';

type AnyToAny = (val: AnyValue) => AnyValue;

export const getTransformFn = (joinedName: TransformFnNames): AnyToAny => {
  const [nameSpace, fnName] = splitPairTranformFnNames(joinedName);
  switch (nameSpace) {
    case 'transformFnArray':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfArray[fnName] as AnyToAny;
    case 'transformFnNumber':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfNumber[fnName] as AnyToAny;
    case 'transformFnString':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfString[fnName] as AnyToAny;
  }
};
