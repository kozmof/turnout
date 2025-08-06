import { isNumber, type AnyValue, type NumberValue, type StringValue } from '../../value';
import { type ToNumberConversion, type ToStringConversion } from '../convert';

export interface TransformNumber<T extends AnyValue> {
  pass: ToNumberConversion<T>
  toStr: ToStringConversion<T>
}

export const tNumber: TransformNumber<AnyValue> = {
  /**
   * 
   * @param val raw value must be `number`
   * @returns raw value must be `number`
   */
  pass: (val: AnyValue): NumberValue => {
    if (isNumber(val)) {
      return val;
    } else {
      throw new Error();
    }
  },
  /**
   * 
   * @param val raw value must be `number`
   * @returns raw value must be `string`
   */
  toStr: (val: AnyValue): StringValue => {
    switch (val.symbol) {
      case 'number':
        return {
          symbol: 'string',
          value: val.value.toString(),
          subSymbol: undefined
        };
      case 'random-number':
        return {
          symbol: 'random-string',
          value: val.value.toString(),
          subSymbol: undefined
        };
      default:
        throw new Error();
    }
  }
};

export type MetaTransformNumber = {
  [K in keyof TransformNumber<NumberValue>]: ReturnType<TransformNumber<NumberValue>[K]>['symbol']
}

export type ParamsMetaTransformNumber = {
  [K in keyof TransformNumber<NumberValue>]: [
    Parameters<TransformNumber<NumberValue>[K]>[0]['symbol'],
  ]
}
