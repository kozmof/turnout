import {
  FuncId,
  ValueId,
  PlugDefineId,
  TapDefineId,
  FuncTable,
  PlugFuncDefTable,
  TapFuncDefTable,
  ValueTable,
} from './types';
import { NodeId } from './graph-types';

export function isFuncId(
  id: NodeId,
  funcTable: FuncTable
): id is FuncId {
  return id in funcTable;
}

export function isValueId(
  id: NodeId,
  valueTable: ValueTable
): id is ValueId {
  return id in valueTable;
}

export function isPlugDefineId(
  id: string,
  plugFuncDefTable: PlugFuncDefTable
): id is PlugDefineId {
  return id in plugFuncDefTable;
}

export function isTapDefineId(
  id: string,
  tapFuncDefTable: TapFuncDefTable
): id is TapDefineId {
  return id in tapFuncDefTable;
}
