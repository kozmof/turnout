import { TOM } from '../../../util/tom';
import { type ReturnMetaTransformFnArray } from '../../preset/array/transformFn';
import { type ReturnMetaTransformFnNumber } from '../../preset/number/transformFn';
import { type ReturnMetaTransformFnString } from '../../preset/string/transformFn';
import { type DeterministicSymbol } from '../../value';
import { metaTfArray, metaTfNumber, metaTfString } from './metaReturn';

export const getTransformFn = ({
  paramType,
}: {
  paramType: DeterministicSymbol;
}):
  | (keyof ReturnMetaTransformFnNumber)[]
  | (keyof ReturnMetaTransformFnString)[]
  | (keyof ReturnMetaTransformFnArray)[] => {
  switch (paramType) {
    case 'string':
      return TOM.keys(metaTfString());
    case 'number':
      return TOM.keys(metaTfNumber());
    case 'boolean': // TODO
      throw new Error();
    case 'array':
      return TOM.keys(metaTfArray());
  }
};
