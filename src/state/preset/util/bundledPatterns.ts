import { type MetaTransformArray } from '../array/transform';
import { type ReturnMetaBinaryFnArray } from '../array/binaryFn';
import { type ReturnMetaBinaryFnGeneric } from '../generic/binaryFn';
import { type MetaTransformNumber } from '../number/transform';
import { type ReturnMetaProcessNumber } from '../number/binaryFn';
import { type MetaTransformString } from '../string/transform';
import { type ReturnMetaProcessString } from '../string/binaryFn';

type RemoveRandom<
  T,
  R extends
    | 'random-number'
    | 'random-boolean'
    | 'random-string'
    | 'random-array',
> = {
  [K in keyof T]: Exclude<T[K], R>;
};

type OnlyRandom<T, R extends 'number' | 'boolean' | 'string' | 'array'> = {
  [K in keyof T]: Exclude<T[K], R>;
};

export const metaPNumber: RemoveRandom<
  ReturnMetaProcessNumber,
  'random-number'
> = {
  add: 'number',
  minus: 'number',
  multiply: 'number',
  divide: 'number',
};

export const metaPNumberRand: OnlyRandom<ReturnMetaProcessNumber, 'number'> = {
  add: `random-${metaPNumber.add}`,
  minus: `random-${metaPNumber.minus}`,
  multiply: `random-${metaPNumber.multiply}`,
  divide: `random-${metaPNumber.divide}`,
};


export const metaPString: ReturnMetaProcessString = {
  concat: 'string',
};

export const metaPStringRand: ReturnMetaProcessString = {
  concat: 'random-string',
};

export const metaPArrayString: ReturnMetaBinaryFnArray = {
  includes: 'boolean',
  get: 'string',
};

export const metaPArrayRandString: ReturnMetaBinaryFnArray = {
  includes: 'random-boolean',
  get: 'random-string',
};


export const metaPArrayNumber: ReturnMetaBinaryFnArray = {
  includes: 'boolean',
  get: 'number',
};

export const metaPArrayRandNumber: ReturnMetaBinaryFnArray = {
  includes: 'random-boolean',
  get: 'random-number',
};

export const metaPArrayBoolean: ReturnMetaBinaryFnArray = {
  includes: 'boolean',
  get: 'boolean',
};

export const metaPArrayRandBoolean: ReturnMetaBinaryFnArray = {
  includes: 'random-boolean',
  get: 'random-boolean',
};

export const metaPGeneric: ReturnMetaBinaryFnGeneric = {
  isEqual: 'boolean',
};

export const metaPGenericRand: ReturnMetaBinaryFnGeneric = {
  isEqual: 'random-boolean',
};

export const metaTNumber: MetaTransformNumber = {
  pass: 'number',
  toStr: 'string',
};

export const metaTNumberRand: MetaTransformNumber = {
  pass: 'random-number',
  toStr: 'random-string',
};

export const metaTString: MetaTransformString = {
  pass: 'string',
  toNumber: 'number',
};

export const metaTStringRand: MetaTransformString = {
  pass: 'random-string',
  toNumber: 'random-number',
};

export const metaTArray: MetaTransformArray = {
  pass: 'array',
  length: 'number',
};

export const metaTArrayRand: MetaTransformArray = {
  pass: 'random-array',
  length: 'random-number',
};
