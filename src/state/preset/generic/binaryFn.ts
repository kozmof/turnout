import { isRandomValue } from '../../ops';
import { type AnyValue, type BooleanValue } from '../../value';
import { type ToBooleanProcess } from '../convert';
import { isComparable } from '../util/isComparable';

export interface BinaryFnGeneric<T extends AnyValue, U extends AnyValue> {
  isEqual: ToBooleanProcess<T, U>
}

export const pGeneric: BinaryFnGeneric<AnyValue, AnyValue> = {
  isEqual: (a: AnyValue, b: AnyValue): BooleanValue => {
    if (isComparable(a, b)) {
      const isRandom = isRandomValue(a, b);
      return {
        symbol: isRandom ? 'random-boolean' : 'boolean',
        value: a.value === b.value, // TODO: Array case,
        subSymbol: undefined
      };
    } else {
      throw new Error();
    }
  },
};

export type ReturnMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue, AnyValue>]: ReturnType<BinaryFnGeneric<AnyValue, AnyValue>[K]>['symbol']
}

export type ParamsMetaBinaryFnGeneric = {
  [K in keyof BinaryFnGeneric<AnyValue, AnyValue>]: [
    Parameters<BinaryFnGeneric<AnyValue, AnyValue>[K]>[0]['symbol'],
    Parameters<BinaryFnGeneric<AnyValue, AnyValue>[K]>[1]['symbol']
  ]
}
