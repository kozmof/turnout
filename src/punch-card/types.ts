import { BinaryFnArrayNames } from '../state-control/preset-funcs/array/binaryFn';
import { TransformFnArrayNames } from '../state-control/preset-funcs/array/transformFn';
import { BinaryFnGenericNames } from '../state-control/preset-funcs/generic/binaryFn';
import { BinaryFnNumberNames } from '../state-control/preset-funcs/number/binaryFn';
import { TransformFnNumberNames } from '../state-control/preset-funcs/number/transformFn';
import { BinaryFnStringNames } from '../state-control/preset-funcs/string/binaryFn';
import { TransformFnStringNames } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';

type BinaryFnNames =
  | BinaryFnArrayNames
  | BinaryFnGenericNames
  | BinaryFnNumberNames
  | BinaryFnStringNames;

type TransformFnNames =
  | TransformFnArrayNames
  | TransformFnNumberNames
  | TransformFnStringNames;

type FuncInterface = { name: string; type: AnyValue };

export type PlugFnType = 'plug';
export type TapFnType = 'tap';

export type PlugFunc = {
  name: BinaryFnNames;
  type: PlugFnType;
  transformFn: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | PlugFunc;
    b: FuncInterface | PlugFunc;
  };
  return: { name: string; type: AnyValue };
};

export type TapFunc = {
  name: string;
  type: TapFnType;
  steps: (TapFunc| PlugFunc)[];
  args: FuncInterface[];
  return: { name: string | null; type: AnyValue };
};
