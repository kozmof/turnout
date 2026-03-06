import { tfArray } from '../../state-control/preset-funcs/array/transformFn';
import { tfBoolean } from '../../state-control/preset-funcs/boolean/transformFn';
import { tfNumber } from '../../state-control/preset-funcs/number/transformFn';
import { tfNull } from '../../state-control/preset-funcs/null/transformFn';
import { tfString } from '../../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../../state-control/value';
import { splitPairTranformFnNames } from '../../util/splitPair';
import { TransformFnNames } from '../types';

// Runtime execution passes values as AnyValue, so transform lookups are normalized
// to a single callable contract regardless of each preset's narrower input type.
type AnyToAny = (val: AnyValue) => AnyValue;

export const getTransformFn = (joinedName: TransformFnNames): AnyToAny => {
  const mayPair = splitPairTranformFnNames(joinedName);
  if (mayPair === null) throw new Error();
  const [namespace, fnName] = mayPair;
  switch (namespace) {
    case 'transformFnArray':
      // String-keyed lookup erases the concrete signature; runtime validation
      // already selected the correct namespace/function pair before this cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfArray[fnName] as AnyToAny;
    case 'transformFnBoolean':
      // String-keyed lookup erases the concrete signature; runtime validation
      // already selected the correct namespace/function pair before this cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfBoolean[fnName] as AnyToAny;
    case 'transformFnNumber':
      // String-keyed lookup erases the concrete signature; runtime validation
      // already selected the correct namespace/function pair before this cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfNumber[fnName] as AnyToAny;
    case 'transformFnNull':
      // String-keyed lookup erases the concrete signature; runtime validation
      // already selected the correct namespace/function pair before this cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfNull[fnName] as AnyToAny;
    case 'transformFnString':
      // String-keyed lookup erases the concrete signature; runtime validation
      // already selected the correct namespace/function pair before this cast.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return tfString[fnName] as AnyToAny;
  }
};
