import {
  any,
  array,
  GenericSchema,
  lazy,
  literal,
  object,
  string,
  union,
} from 'valibot';
import { binaryFnNames } from './binaryFnNames';
import { PlugFuncType, PlugFunc, TapFuncType, TapFunc } from '../types';
import { transformFnNames } from './transformFnNames';
import { baseTypeSymbols } from '../../state-control/value';

const plugFuncType: PlugFuncType = 'plug';
const tapFuncType: TapFuncType = 'tap';

const symbolLiterals = baseTypeSymbols.map((symbol) => literal(symbol));

const anyValueSchema = object({
  symbol: union(symbolLiterals),
  subSymbol: any(),
  value: any(),
  effects: array(string()), // Array of effect strings
});

const funcInterfaceSchema = object({
  name: string(),
  type: any(),
  value: anyValueSchema,
});

export const plugFuncSchema: GenericSchema<PlugFunc> = object({
  name: binaryFnNames(),
  type: literal(plugFuncType),
  transformFn: object({
    a: object({ name: transformFnNames() }),
    b: object({ name: transformFnNames() }),
  }),
  args: object({
    a: union([funcInterfaceSchema, lazy(() => plugFuncSchema)]),
    b: union([funcInterfaceSchema, lazy(() => plugFuncSchema)]),
  }),
});

export const tapFuncSchema: GenericSchema<TapFunc> = object({
  name: string(),
  type: literal(tapFuncType),
  steps: array(union([plugFuncSchema, lazy(() => tapFuncSchema)])),
  args: array(funcInterfaceSchema),
});
