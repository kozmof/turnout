import { type AnyValue, type BooleanValue } from '../../value';
import { type ToBooleanProcess } from '../convert';
import { isComparable } from '../util/isComparable';
import { propageteRandom } from '../util/propagateRandom';

export interface BinaryFnGeneric<T extends AnyValue> {
  isEqual: ToBooleanProcess<T, T>;
}

export const bfGeneric: BinaryFnGeneric<AnyValue> = {
  isEqual: (a: AnyValue, b: AnyValue): BooleanValue => {
    if (isComparable(a, b)) {
      return {
        symbol: propageteRandom('boolean', a, b),
        value: a.value === b.value, // TODO: Array case,
        subSymbol: undefined,
      };
    } else {
      throw new Error();
    }
  },
};

export type ReturnMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: ReturnType<
    BinaryFnGeneric<AnyValue>[K]
  >['symbol'];
};

export type ParamsMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue>]: [
    Parameters<BinaryFnGeneric<AnyValue>[K]>[0]['symbol'],
    Parameters<BinaryFnGeneric<AnyValue>[K]>[1]['symbol'],
  ];
};
