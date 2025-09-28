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

export type EchoFunc = {
  name: BinaryFnNames;
  transform: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | EchoFunc;
    b: FuncInterface | EchoFunc;
  };
  return: { name: string | null; type: AnyValue };
};

export type SinkFunc = {
  name: string;
  steps: (SinkFunc | EchoFunc)[];
  args: FuncInterface[];
  return: { name: string | null; type: AnyValue };
};
