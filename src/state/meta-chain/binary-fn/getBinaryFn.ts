import { TOM } from '../../../util/tom';
import { type ReturnMetaBinaryFnArray } from '../../preset/array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../../preset/generic/binaryFn';
import { type ReturnMetaBinaryFnNumber } from '../../preset/number/binaryFn';
import { type ReturnMetaBinaryFnString } from '../../preset/string/binaryFn';
import { deterministicSymbols, type DeterministicSymbol } from '../../value';
import {
  metaBfGenericParams,
  metaBfNumberParams,
  metaBfStringParams,
} from './metaParams';

type Pattern = `${DeterministicSymbol}_${DeterministicSymbol}`;

const seek = <T extends Record<string, [string, string]>>(
  callBack: (fnName: keyof T) => void,
  obj: T,
  patterns: string[]
): void => {
  for (const [fnName, fnParams] of TOM.entries(obj)) {
    if (patterns.includes(`${fnParams[0]}_${fnParams[1]}`)) {
      callBack(fnName);
    }
  }
};

export const getBinaryFn = ({
  paramType1,
  paramType2,
}: {
  paramType1: DeterministicSymbol;
  paramType2: DeterministicSymbol;
}): Array<
  | keyof ReturnMetaBinaryFnNumber
  | keyof ReturnMetaBinaryFnString
  | keyof ReturnMetaBinaryFnGeneric
  | keyof ReturnMetaBinaryFnArray
> => {
  const pattern1: Pattern = `${paramType1}_${paramType2}`;
  const pattern2: Pattern = `${paramType2}_${paramType1}`;
  const patterns = [pattern1, pattern2];
  const fns: Array<
    | keyof ReturnMetaBinaryFnNumber
    | keyof ReturnMetaBinaryFnString
    | keyof ReturnMetaBinaryFnGeneric
    | keyof ReturnMetaBinaryFnArray
  > = [];

  const paramGens = [
    metaBfNumberParams(),
    metaBfStringParams(),
    ...deterministicSymbols.map((symbol) => metaBfGenericParams(symbol)),
  ];

  for (const paramGen of paramGens) {
    seek(
      (fnName) => {
        fns.push(fnName);
      },
      paramGen,
      patterns
    );
  }

  return fns;
};
