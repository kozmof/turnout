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
    case 'binaryFnArray':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfArray[fnName] as AnyToAny;
    case 'binaryFnGeneric':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfGeneric[fnName] as AnyToAny;
    case 'binaryFnNumber':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfNumber[fnName] as AnyToAny;
    case 'binaryFnString':
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return bfString[fnName] as AnyToAny;
  }
};
