import { BinaryFnArrayNames } from '../state-control/preset-funcs/array/binaryFn';
import { TransformFnArrayNames } from '../state-control/preset-funcs/array/transformFn';
import { BinaryFnGenericNames } from '../state-control/preset-funcs/generic/binaryFn';
import { BinaryFnNumberNames } from '../state-control/preset-funcs/number/binaryFn';
import { TransformFnNumberNames } from '../state-control/preset-funcs/number/transformFn';
import { BinaryFnStringNames } from '../state-control/preset-funcs/string/binaryFn';
import { TransformFnStringNames } from '../state-control/preset-funcs/string/transformFn';
import { AnyValue } from '../state-control/value';
import { Brand } from '../util/brand';

export type BinaryFnNames =
  | BinaryFnArrayNames
  | BinaryFnGenericNames
  | BinaryFnNumberNames
  | BinaryFnStringNames;

export type TransformFnNames =
  | TransformFnArrayNames
  | TransformFnNumberNames
  | TransformFnStringNames;

type FuncInterface = { name: string; type: 'value'; value: AnyValue };

export type PlugFuncType = 'plug';
export type TapFuncType = 'tap';

export type PlugFunc = {
  name: BinaryFnNames;
  type: PlugFuncType;
  transformFn: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | PlugFunc;
    b: FuncInterface | PlugFunc;
  };
};

export type TapFunc = {
  name: string;
  type: TapFuncType;
  steps: (TapFunc | PlugFunc)[];
  args: FuncInterface[];
};

type PlugDefineId =  Brand<string, 'plugDefineId'>;
type TapDefineId =  Brand<string, 'tapDefineId'>;
type ValueId = Brand<string, 'valueId'>;
type FuncId = Brand<string, 'funcId'>;
type InterfaceArgId = Brand<string, 'interfaceArgId'>;

export type FuncTable = {
  [id in FuncId]: {
    defId: PlugDefineId | TapDefineId;
    argMap: {
      [argName in string]: FuncId | ValueId;
    };
    returnId: ValueId;
  };
};

export type PlugFuncDefTable = {
  [defId in PlugDefineId]: {
    name: BinaryFnNames;
    transformFn: {
      a: { name: TransformFnNames };
      b: { name: TransformFnNames };
    };
    args: {
      a: PlugDefineId | InterfaceArgId;
      b: PlugDefineId | InterfaceArgId;
    };
    interfaceArgs: InterfaceArgId[];
  };
};

export type TapFuncDefTable = {
  [defId in TapDefineId]: {
    sequence: FuncId[];
    interfaceArgs: InterfaceArgId[];
  };
};
