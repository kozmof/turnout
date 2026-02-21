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
import { CombineFuncType, CombineFunc, PipeFuncType, PipeFunc } from '../types';
import { transformFnNames } from './transformFnNames';
import { baseTypeSymbols } from '../../state-control/value';

const combineFuncType: CombineFuncType = 'combine';
const pipeFuncType: PipeFuncType = 'pipe';

const symbolLiterals = baseTypeSymbols.map((symbol) => literal(symbol));

const anyValueSchema = object({
  symbol: union(symbolLiterals),
  subSymbol: any(),
  value: any(),
  tags: array(string()), // Array of tag strings
});

const funcInterfaceSchema = object({
  name: string(),
  type: any(),
  value: anyValueSchema,
});

export const combineFuncSchema: GenericSchema<CombineFunc> = object({
  name: binaryFnNames(),
  type: literal(combineFuncType),
  transformFn: object({
    a: object({ name: transformFnNames() }),
    b: object({ name: transformFnNames() }),
  }),
  args: object({
    a: union([funcInterfaceSchema, lazy(() => combineFuncSchema)]),
    b: union([funcInterfaceSchema, lazy(() => combineFuncSchema)]),
  }),
});

export const pipeFuncSchema: GenericSchema<PipeFunc> = object({
  name: string(),
  type: literal(pipeFuncType),
  steps: array(union([combineFuncSchema, lazy(() => pipeFuncSchema)])),
  args: array(funcInterfaceSchema),
});
