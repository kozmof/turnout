import { bfArray } from '../../state-control/preset-funcs/array/binaryFn';
import { bfBoolean } from '../../state-control/preset-funcs/boolean/binaryFn';
import { bfGeneric } from '../../state-control/preset-funcs/generic/binaryFn';
import { bfNumber } from '../../state-control/preset-funcs/number/binaryFn';
import { bfString } from '../../state-control/preset-funcs/string/binaryFn';
import { AnyValue } from '../../state-control/value';
import { splitPairBinaryFnNames } from '../../util/splitPair';
import { BinaryFnNames } from '../types';

// Runtime execution resolves binary functions dynamically, so we expose a single
// AnyValue-based contract that works across all namespaced preset implementations.
type AnyToAny = (valA: AnyValue, valB: AnyValue) => AnyValue;

export const getBinaryFn = (joinedName: BinaryFnNames): AnyToAny => {
  const mayPair = splitPairBinaryFnNames(joinedName);
  if (mayPair === null) throw new Error();
  const [namespace, fnName] = mayPair;

  switch (namespace) {
    case 'binaryFnArray':
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfArray[fnName] as AnyToAny;
    case 'binaryFnBoolean':
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfBoolean[fnName] as AnyToAny;
    case 'binaryFnGeneric':
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfGeneric[fnName] as AnyToAny;
    case 'binaryFnNumber':
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfNumber[fnName] as AnyToAny;
    case 'binaryFnString':
      // String-keyed lookup widens the function type; namespace/function parsing
      // above ensures this cast matches the selected preset implementation.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfString[fnName] as AnyToAny;
  }
};
