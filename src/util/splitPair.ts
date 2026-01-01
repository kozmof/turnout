import { BinaryFnNames, TransformFnNames } from '../punch-card/types';
import { NAMESPACE_DELIMITER, type NamespaceDelimiter } from './constants';

type SplitPair<S extends string> =
  S extends `${infer Left}${NamespaceDelimiter}${infer Right}` ? [Left, Right] : never;

const isTransformFnName = (
  pair: string[]
): pair is SplitPair<TransformFnNames> => {
  if (pair.length === 2) {
    return true;
  } else {
    return false;
  }
};

const isBinaryFnName = (
  pair: string[]
): pair is SplitPair<BinaryFnNames> => {
  if (pair.length === 2) {
    return true;
  } else {
    return false;
  }
};

export const splitPairTranformFnNames = (
  joinedName: TransformFnNames
): SplitPair<TransformFnNames> | null=> {
  const pair = joinedName.split(NAMESPACE_DELIMITER);
  if (isTransformFnName(pair)) {
    return pair;
  } else {
    return null
  }
};

export const splitPairBinaryFnNames = (
  joinedName: BinaryFnNames
): SplitPair<BinaryFnNames> | null => {
  const pair = joinedName.split(NAMESPACE_DELIMITER);
  if (isBinaryFnName(pair)) {
    return pair;
  } else {
    return null
  }
};
