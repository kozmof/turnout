import { isRandomValue } from '../../ops';
import { type StringValue } from '../../value';
import { type StringToString } from '../convert';

export interface ProcessString {
  concat: StringToString;
}

export const pString: ProcessString = {
  concat: (a: StringValue, b: StringValue): StringValue => {
    const isRandom = isRandomValue(a, b);
    return {
      symbol: isRandom ? 'random-string' : 'string',
      value: a.value + b.value,
      subSymbol: undefined,
    };
  },
};

export type ReturnMetaProcessString = {
  [K in keyof ProcessString]: ReturnType<ProcessString[K]>['symbol'];
};

export type ParamsMetaProcessString = {
  [K in keyof ProcessString]: [
    Parameters<ProcessString[K]>[0]['symbol'],
    Parameters<ProcessString[K]>[1]['symbol'],
  ];
};
