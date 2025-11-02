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
import { binaryFnNames } from './literal-schema/binaryFnNames';
import { PlugFuncType, PlugFunc, TapFuncType, TapFunc } from './types';
import { transformFnNames } from './literal-schema/transformFnNames';
import {
  deterministicSymbols,
  nonDeterministicSymbols,
} from '../state-control/value';

const plugFuncType: PlugFuncType = 'plug';
const tapFuncType: TapFuncType = 'tap';

const symbolLiterals = [
  ...deterministicSymbols,
  ...nonDeterministicSymbols,
].map((symbol) => literal(symbol));

const anyValueSchema = object({
  symbol: union(symbolLiterals),
  subSymbol: any(),
  value: any(),
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
