import {
  type ArrayValue,
  type AnyValue,
  type BooleanValue,
  type ControlledBooleanValue,
  type ControlledNumberValue,
  type ControlledStringValue,
  type NumberValue,
  type StringValue,
} from '../../value';
import {
  type ReturnMetaTransformFnArray,
  type TransformFnArray,
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
  type ReturnMetaTransformFnNumber,
  type TransformFnNumber,
} from '../number/transform';
import {
  type ReturnMetaBinaryFnNumber,
  type BinaryFnNumber,
} from '../number/binaryFn';
import {
  type ReturnMetaTransformFnString,
  type TransformFnString,
} from '../string/transform';
import {
  type ReturnMetaBinaryFnString,
  type BinaryFnString,
} from '../string/binaryFn';

const numberType = (isRandom: boolean): NumberValue['symbol'] => {
  return isRandom ? 'random-number' : 'number';
};

const stringType = (isRandom: boolean): StringValue['symbol'] => {
  return isRandom ? 'random-string' : 'string';
};

const booleanType = (isRandom: boolean): BooleanValue['symbol'] => {
  return isRandom ? 'random-boolean' : 'boolean';
};

const arrayType = (isRandom: boolean): ArrayValue['symbol'] => {
  return isRandom ? 'random-array' : 'array';
};

export type ElemType =
  | ControlledNumberValue['symbol']
  | ControlledStringValue['symbol']
  | ControlledBooleanValue['symbol'];

const someType = (
  isRandom: boolean,
  elemType: ElemType
): NumberValue['symbol'] | StringValue['symbol'] | BooleanValue['symbol'] => {
  switch (elemType) {
    case 'number':
      return numberType(isRandom);
    case 'string':
      return stringType(isRandom);
    case 'boolean':
      return booleanType(isRandom);
  }
};

export const metaBfNumber = (isRandom: boolean): ReturnMetaBinaryFnNumber => {
  return {
    add: numberType(isRandom),
    minus: numberType(isRandom),
    multiply: numberType(isRandom),
    divide: numberType(isRandom),
  };
};

export const metaBfString = (isRandom: boolean): ReturnMetaBinaryFnString => {
  return {
    concat: stringType(isRandom),
  };
};

export const metaBfArray = (
  isRandom: boolean,
  elemType: ElemType
): ReturnMetaBinaryFnArray => {
  return {
    includes: booleanType(isRandom),
    get: someType(isRandom, elemType),
  };
};

export const metaBfGeneric = (isRandom: boolean): ReturnMetaBinaryFnGeneric => {
  return {
    isEqual: booleanType(isRandom),
  };
};

export const getResultBinaryFnType = {
  bfNumber: (
    fnName: keyof BinaryFnNumber,
    isRandom: boolean
  ): ReturnMetaBinaryFnNumber[keyof BinaryFnNumber] => {
    return metaBfNumber(isRandom)[fnName];
  },
  bfString: (
    fnName: keyof BinaryFnString,
    isRandom: boolean
  ): ReturnMetaBinaryFnString[keyof BinaryFnString] => {
    return metaBfString(isRandom)[fnName];
  },
  bfGeneric: (
    fnName: keyof BinaryFnGeneric<AnyValue>,
    isRandom: boolean
  ): ReturnMetaBinaryFnGeneric[keyof BinaryFnGeneric<AnyValue>] => {
    return metaBfGeneric(isRandom)[fnName];
  },
  bfArray: (
    fnName: keyof BinaryFnArray,
    elemType: ElemType,
    isRandom: boolean
  ): ReturnMetaBinaryFnArray[keyof BinaryFnArray] => {
    return metaBfArray(isRandom, elemType)[fnName];
  },
};

export const metaTfNumber = (isRandom: boolean): ReturnMetaTransformFnNumber => {
  return {
    pass: numberType(isRandom),
    toStr: stringType(isRandom),
  };
};

export const metaTfString = (isRandom: boolean): ReturnMetaTransformFnString => {
  return {
    pass: stringType(isRandom),
    toNumber: numberType(isRandom),
  };
};

export const metaTfArray = (isRandom: boolean): ReturnMetaTransformFnArray => {
  return {
    pass: arrayType(isRandom),
    length: numberType(isRandom),
  };
};

export const getResultTransformFnType = {
  tfNumber: (
    fnName: keyof TransformFnNumber,
    isRandom: boolean
  ): ReturnMetaTransformFnNumber[keyof TransformFnNumber] => {
    return metaTfNumber(isRandom)[fnName];
  },
  tfString: (
    fnName: keyof TransformFnString,
    isRandom: boolean
  ): ReturnMetaTransformFnString[keyof TransformFnString] => {
    return metaTfString(isRandom)[fnName];
  },
  tfArray: (
    fnName: keyof TransformFnArray,
    isRandom: boolean
  ): ReturnMetaTransformFnArray[keyof TransformFnArray] => {
    return metaTfArray(isRandom)[fnName];
  },
};
