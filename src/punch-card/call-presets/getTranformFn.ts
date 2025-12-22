import { tfArray } from '../../state-control/preset-funcs/array/transformFn';
import { tfNumber } from '../../state-control/preset-funcs/number/transformFn';
import { tfString } from '../../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../../state-control/value';
import { splitPairTranformFnNames } from '../../util/splitPair';
import { TransformFnNames } from '../types';

type AnyToAny = (val: AnyValue) => AnyValue;

export const getTransformFn = (joinedName: TransformFnNames): AnyToAny => {
  const [nameSpace, fnName] = splitPairTranformFnNames(joinedName);
  switch (nameSpace) {
    case 'transformFnArray': {
      const fn = tfArray[fnName];
      if (!fn) {
        throw new Error(`Transform function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    case 'transformFnNumber': {
      const fn = tfNumber[fnName];
      if (!fn) {
        throw new Error(`Transform function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    case 'transformFnString': {
      const fn = tfString[fnName];
      if (!fn) {
        throw new Error(`Transform function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    default: {
      const _exhaustive: never = nameSpace;
      throw new Error(`Unknown transform function namespace: ${_exhaustive}`);
    }
  }
};
