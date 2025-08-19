import { type AnyValue } from '../../value';
import {
  type MetaTransformArray,
  type TransformArray,
} from '../array/transform';
import {
  type ReturnMetaBinaryFnArray,
  type BinaryFnArray,
} from '../array/binaryFn';
import {
  type ReturnMetaBinaryFnGeneric,
  type BinaryFnGeneric,
} from '../generic/binaryFn';
import {
  type MetaTransformNumber,
  type TransformNumber,
} from '../number/transform';
import {
  type ReturnMetaBinaryFnNumber,
  type BinaryFnNumber,
} from '../number/binaryFn';
import {
  type MetaTransformString,
  type TransformString,
} from '../string/transform';
import {
  type ReturnMetaBinaryFnString,
  type BinaryFnString,
} from '../string/binaryFn';

export const metaPNumber: ReturnMetaBinaryFnNumber = {
  add: 'number',
  minus: 'number',
  multiply: 'number',
  divide: 'number',
};

export const metaPNumberRand: ReturnMetaBinaryFnNumber = {
  add: 'random-number',
  minus: 'random-number',
  multiply: 'random-number',
  divide: 'random-number',
};

export const metaPString: ReturnMetaBinaryFnString = {
  concat: 'string',
};

export const metaPStringRand: ReturnMetaBinaryFnString = {
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

export const getResultProcessType = {
  bfNumber: (key: keyof BinaryFnNumber, isRandom: boolean) => {
    if (isRandom) {
      return metaPNumberRand[key];
    } else {
      return metaPNumber[key];
    }
  },
  bfString: (key: keyof BinaryFnString, isRandom: boolean) => {
    if (isRandom) {
      return metaPStringRand[key];
    } else {
      return metaPString[key];
    }
  },
  bfArray: (
    key: keyof BinaryFnArray,
    isRandom: boolean,
    itemType: 'string' | 'number' | 'boolean'
  ) => {
    switch (itemType) {
      case 'string': {
        if (isRandom) {
          return metaPArrayRandString[key];
        } else {
          return metaPArrayString[key];
        }
      }
      case 'boolean': {
        if (isRandom) {
          return metaPArrayRandBoolean[key];
        } else {
          return metaPArrayBoolean[key];
        }
      }
      case 'number': {
        if (isRandom) {
          return metaPArrayRandNumber[key];
        } else {
          return metaPArrayNumber[key];
        }
      }
    }
  },
  bfGeneric: (
    key: keyof BinaryFnGeneric<AnyValue, AnyValue>,
    isRandom: boolean
  ) => {
    if (isRandom) {
      return metaPGenericRand[key];
    } else {
      return metaPGeneric[key];
    }
  },
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

export const getResultTransformType = {
  tNumber: (key: keyof TransformNumber, isRandom: boolean) => {
    if (isRandom) {
      return metaTNumberRand[key];
    } else {
      return metaTNumber[key];
    }
  },
  tString: (key: keyof TransformString, isRandom: boolean) => {
    if (isRandom) {
      return metaTStringRand[key];
    } else {
      return metaTString[key];
    }
  },
  tArray: (key: keyof TransformArray, isRandom: boolean) => {
    if (isRandom) {
      return metaTArrayRand[key];
    } else {
      return metaTArray[key];
    }
  },
};
