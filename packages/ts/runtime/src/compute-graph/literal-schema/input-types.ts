import { BinaryFnNames } from "../types.js";
import { AnyValue } from "../../state-control/value.js";
import { TransformFnNames } from "../types.js";

type FuncInterface = { name: string; type: "value"; value: AnyValue };

export type CombineFuncType = "combine";
export type PipeFuncType = "pipe";

export type CombineFunc = {
  name: BinaryFnNames;
  type: CombineFuncType;
  transformFn: {
    a: { name: TransformFnNames };
    b: { name: TransformFnNames };
  };
  args: {
    a: FuncInterface | CombineFunc;
    b: FuncInterface | CombineFunc;
  };
};

export type PipeFunc = {
  name: string;
  type: PipeFuncType;
  steps: (PipeFunc | CombineFunc)[];
  args: FuncInterface[];
};
