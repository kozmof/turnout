import { type MetaPreprocessArray, type PreprocessArray } from "../array/preprocess";
import { type MetaProcessGeneric, type ProcessGeneric } from "../generic/process";
import { type MetaPreProcessNumber, type PreprocessNumber } from "../number/preprocess";
import { type MetaProcessNumber, type ProcessNumber } from "../number/process";
import { type MetaPreProcessString, type PreprocessString } from "../string/preprocess";
import { type MetaProcessString, type ProcessString } from "../string/process";

export const getNextProcessType = {
  pNumber: (key: keyof ProcessNumber, meta: MetaProcessNumber) => {
    return meta[key];
  },
  pString: (key: keyof ProcessString, meta: MetaProcessString) => {
    return meta[key];
  },
  pGeneric: (key: keyof ProcessGeneric, meta: MetaProcessGeneric) => {
    return meta[key];
  }
};

export const getNextPreProcessType = {
  ppNumber: (key: keyof PreprocessNumber, meta: MetaPreProcessNumber) => {
    return meta[key];
  },
  ppString: (key: keyof PreprocessString, meta: MetaPreProcessString) => {
    return meta[key];
  },
  ppArray: (key: keyof PreprocessArray, meta: MetaPreprocessArray) => {
    return meta[key];
  },
};