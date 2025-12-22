import { bfArray } from '../../state-control/preset-funcs/array/binaryFn';
import { bfGeneric } from '../../state-control/preset-funcs/generic/binaryFn';
import { bfNumber } from '../../state-control/preset-funcs/number/binaryFn';
import { bfString } from '../../state-control/preset-funcs/string/binaryFn';
import { AnyValue } from '../../state-control/value';
import { splitPairBinaryFnNames } from '../../util/splitPair';
import { BinaryFnNames } from '../types';

type AnyToAny = (valA: AnyValue, valB: AnyValue) => AnyValue;

export const getBinaryFn = (joinedName: BinaryFnNames): AnyToAny => {
  const [nameSpace, fnName] = splitPairBinaryFnNames(joinedName);

  switch (nameSpace) {
    case 'binaryFnArray': {
      const fn = bfArray[fnName];
      if (!fn) {
        throw new Error(`Binary function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    case 'binaryFnGeneric': {
      const fn = bfGeneric[fnName];
      if (!fn) {
        throw new Error(`Binary function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    case 'binaryFnNumber': {
      const fn = bfNumber[fnName];
      if (!fn) {
        throw new Error(`Binary function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    case 'binaryFnString': {
      const fn = bfString[fnName];
      if (!fn) {
        throw new Error(`Binary function not found: ${joinedName} (namespace: ${nameSpace}, function: ${fnName})`);
      }
      return fn as AnyToAny;
    }
    default: {
      const _exhaustive: never = nameSpace;
      throw new Error(`Unknown binary function namespace: ${_exhaustive}`);
    }
  }
};
