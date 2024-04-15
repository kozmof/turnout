import { type MetaProcessGeneric, type ProcessGeneric } from "../generic/process";
import { type MetaPreProcessString, type PreprocessString } from "../string/preprocess";
import { type MetaProcessString, type ProcessString } from "../string/process";

export const getNextProcessType = {
  pString: (key: keyof ProcessString, meta: MetaProcessString) => {
    return meta[key];
  },
  pGeneric: (key: keyof ProcessGeneric, meta: MetaProcessGeneric) => {
    return meta[key];
  }
};

export const getNextPreProcessType = {
  ppString: (key: keyof PreprocessString, meta: MetaPreProcessString) => {
    return meta[key];
  },
};