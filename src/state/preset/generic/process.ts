import { isRandomValue } from '../../ops';
import { type AnyValue, type BooleanValue } from '../../value';
import { type ToBooleanProcess } from '../convert';
import { isComparable } from '../util/isComparable';

export interface ProcessGeneric<T extends AnyValue, U extends AnyValue> {
  isEqual: ToBooleanProcess<T, U>
}

export const pGeneric: ProcessGeneric<AnyValue, AnyValue> = {
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

export type ReturnMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AnyValue, AnyValue>]: ReturnType<ProcessGeneric<AnyValue, AnyValue>[K]>['symbol']
}

export type ParamsMetaProcessGeneric = {
  [K in keyof ProcessGeneric<AnyValue, AnyValue>]: [
    Parameters<ProcessGeneric<AnyValue, AnyValue>[K]>[0]['symbol'],
    Parameters<ProcessGeneric<AnyValue, AnyValue>[K]>[1]['symbol']
  ]
}
