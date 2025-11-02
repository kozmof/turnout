import { BinaryFnNames, TransformFnNames } from '../punch-card/types';

type SplitPair<S extends string> =
  S extends `${infer Left}::${infer Right}` ? [Left, Right] : never;

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
): SplitPair<TransformFnNames> => {
  const pair = joinedName.split('::');
  if (isTransformFnName(pair)) {
    return pair;
  } else {
    throw new Error();
  }
};

export const splitPairBinaryFnNames = (
  joinedName: BinaryFnNames
): SplitPair<BinaryFnNames> => {
  const pair = joinedName.split('::');
  if (isBinaryFnName(pair)) {
    return pair;
  } else {
    throw new Error();
  }
};
