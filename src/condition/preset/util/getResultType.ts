import { type AllValues, type ArrayValue, type NonArrayValue, type NumberValue, type StringValue } from "../../value";
import { type MetaPreprocessArray, type PreprocessArray } from "../array/preprocess";
import { type MetaProcessArray, type ProcessArray } from "../array/process";
import { type MetaProcessGeneric, type ProcessGeneric } from "../generic/process";
import { type MetaPreprocessNumber, type PreprocessNumber } from "../number/preprocess";
import { type MetaProcessNumber, type ProcessNumber } from "../number/process";
import { type MetaPreprocessString, type PreprocessString } from "../string/preprocess";
import { type MetaProcessString, type ProcessString } from "../string/process";

export const metaPNumber: MetaProcessNumber = {
  add: "number",
  minus: "number",
  multiply: "number",
  divide: "number"
};

export const metaPNumberRand: MetaProcessNumber = {
  add: "random-number",
  minus: "random-number",
  multiply: "random-number",
  divide: "random-number"
};

export const metaPString: MetaProcessString = {
  concat: "string"
};

export const metaPStringRand: MetaProcessString = {
  concat: "random-string"
};

export  const metaPArray: MetaProcessArray = {
  includes: "boolean"
};

export  const metaPArrayRand: MetaProcessArray = {
  includes: "random-boolean"
};

export const metaPGeneric: MetaProcessGeneric = {
  isEqual: "boolean"
};

export  const metaPGenericRand: MetaProcessGeneric = {
  isEqual: "random-boolean"
};

export const getResultProcessType = {
  pNumber: (key: keyof ProcessNumber<NumberValue, NumberValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPNumberRand[key];
    } else {
      return metaPNumber[key];
    }
  },
  pString: (key: keyof ProcessString<StringValue, StringValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPStringRand[key];
    } else {
      return metaPString[key];
    }
  },
  pArray: (key: keyof ProcessArray<ArrayValue, NonArrayValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPArrayRand[key];
    } else {
      return metaPArray[key];
    }
  },
  pGeneric: (key: keyof ProcessGeneric<AllValues, AllValues>, isRandom: boolean) => {
    if(isRandom) {
      return metaPGenericRand[key];
    } else {
      return metaPGeneric[key];
    }
  }
};

export const metaPPNumber: MetaPreprocessNumber = {
  pass: "number",
  toStr: "string"
};

export const metaPPNumberRand: MetaPreprocessNumber = {
  pass: "random-number",
  toStr: "random-string"
};

export const metaPPString: MetaPreprocessString = {
  pass: "string",
  toNumber: "number"
};

export const metaPPStringRand: MetaPreprocessString = {
  pass: "random-string",
  toNumber: "random-number"
};

export const metaPPArray: MetaPreprocessArray = {
  pass: "array",
  length: "number"
};

export const metaPPArrayRand: MetaPreprocessArray = {
  pass: "random-array",
  length: "random-number"
};

export const getResultPreprocessType = {
  ppNumber: (key: keyof PreprocessNumber<NumberValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPPNumberRand[key];
    } else {
      return metaPPNumber[key];
    }
  },
  ppString: (key: keyof PreprocessString<StringValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPPStringRand[key];
    } else {
      return metaPPString[key];
    }
  },
  ppArray: (key: keyof PreprocessArray<ArrayValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPPArrayRand[key];
    } else {
      return metaPPArray[key];
    }
  },
};
