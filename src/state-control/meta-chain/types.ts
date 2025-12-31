// Maybe deprecated
import {
  type ArrayValue,
  type BooleanValue,
  type NumberValue,
  type StringValue,
  type BaseTypeSymbol,
} from '../value';

export const numberType = (): NumberValue['symbol'] => 'number';
export const stringType = (): StringValue['symbol'] => 'string';
export const booleanType = (): BooleanValue['symbol'] => 'boolean';
export const arrayType = (): ArrayValue['symbol'] => 'array';

export type ElemType = Exclude<BaseTypeSymbol, 'array'>;

export const someType = (
  elemType: ElemType
): NumberValue['symbol'] | StringValue['symbol'] | BooleanValue['symbol'] => {
  switch (elemType) {
    case 'number':
      return numberType();
    case 'string':
      return stringType();
    case 'boolean':
      return booleanType();
  }
};
