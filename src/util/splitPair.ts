import { BinaryFnNames, TransformFnNames } from '../punch-card/types';
import { NAMESPACE_DELIMITER, type NamespaceDelimiter } from './constants';

type SplitPair<S extends string> =
  S extends `${infer Left}${NamespaceDelimiter}${infer Right}` ? [Left, Right] : never;

const isTransformFnName = (
  pair: string[]
): pair is SplitPair<TransformFnNames> => {
  if (pair.length !== 2) return false;

  const [namespace, name] = pair;

  // Validate both parts are non-empty strings
  if (typeof namespace !== 'string' || namespace.length === 0) return false;
  if (typeof name !== 'string' || name.length === 0) return false;

  return true;
};

const isBinaryFnName = (
  pair: string[]
): pair is SplitPair<BinaryFnNames> => {
  if (pair.length !== 2) return false;

  const [namespace, name] = pair;

  // Validate both parts are non-empty strings
  if (typeof namespace !== 'string' || namespace.length === 0) return false;
  if (typeof name !== 'string' || name.length === 0) return false;

  return true;
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
