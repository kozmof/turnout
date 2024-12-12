import { type AllValue, type ArrayValue, type NonArrayValue, type NumberValue, type StringValue } from "../../value";
import { type MetaTransformArray, type TransformArray } from "../array/transform";
import { type MetaProcessArray, type ProcessArray } from "../array/process";
import { type MetaProcessGeneric, type ProcessGeneric } from "../generic/process";
import { type MetaTransformNumber, type TransformNumber } from "../number/transform";
import { type MetaProcessNumber, type ProcessNumber } from "../number/process";
import { type MetaTransformString, type TransformString } from "../string/transform";
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
  pGeneric: (key: keyof ProcessGeneric<AllValue, AllValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaPGenericRand[key];
    } else {
      return metaPGeneric[key];
    }
  }
};

export const metaTNumber: MetaTransformNumber = {
  pass: "number",
  toStr: "string"
};

export const metaTNumberRand: MetaTransformNumber = {
  pass: "random-number",
  toStr: "random-string"
};

export const metaTString: MetaTransformString = {
  pass: "string",
  toNumber: "number"
};

export const metaTStringRand: MetaTransformString = {
  pass: "random-string",
  toNumber: "random-number"
};

export const metaTArray: MetaTransformArray = {
  pass: "array",
  length: "number"
};

export const metaTArrayRand: MetaTransformArray = {
  pass: "random-array",
  length: "random-number"
};

export const getResultTransformType = {
  tNumber: (key: keyof TransformNumber<NumberValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaTNumberRand[key];
    } else {
      return metaTNumber[key];
    }
  },
  tString: (key: keyof TransformString<StringValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaTStringRand[key];
    } else {
      return metaTString[key];
    }
  },
  tArray: (key: keyof TransformArray<ArrayValue>, isRandom: boolean) => {
    if(isRandom) {
      return metaTArrayRand[key];
    } else {
      return metaTArray[key];
    }
  },
};
