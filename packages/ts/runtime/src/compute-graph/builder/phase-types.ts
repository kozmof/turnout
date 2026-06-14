import type { ValueId, CombineDefineId } from "../types.js";
import type { ContextBuilder as BuilderState } from "./types.js";
import type { AnyValue, BaseTypeSymbol } from "../../state-control/value.js";

export type ValuePhaseResult = {
  readonly valueTable: Record<string, AnyValue>;
};

export type FunctionPhaseState = {
  readonly valueTable: Record<string, AnyValue>;
  funcTable: BuilderState["funcTable"];
  combineFuncDefTable: BuilderState["combineFuncDefTable"];
  pipeFuncDefTable: BuilderState["pipeFuncDefTable"];
  condFuncDefTable: BuilderState["condFuncDefTable"];
  stepMetadata: BuilderState["stepMetadata"];
  returnValueMetadata: BuilderState["returnValueMetadata"];
  returnIdByFuncId: Record<string, ValueId>;
  stepOutputIdByFuncStep: Record<string, ValueId>;
  combineDefIdBySignature: Map<string, CombineDefineId>;
  returnTypeByFuncKey: Map<string, BaseTypeSymbol>;
};

export type ReferenceIndex = {
  readonly allKeys: Set<string>;
  readonly valueKeys: Set<string>;
  readonly functionKeys: Set<string>;
};
