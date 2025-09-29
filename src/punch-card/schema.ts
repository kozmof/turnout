import {
  any,
  array,
  GenericSchema,
  lazy,
  literal,
  nullable,
  object,
  string,
  union,
} from 'valibot';
import { binaryFnNames } from './literal-schema/binaryFnNames';
import { PlugFnType, PlugFunc, TapFnType, TapFunc } from './types';
import { transformFnNames } from './literal-schema/transformFnNames';

const plugFnType: PlugFnType = 'plug';
const tapFnType: TapFnType = 'tap';

const funcInterfaceSchema = object({
  name: string(),
  type: any(),
});

export const plugFuncSchema: GenericSchema<PlugFunc> = object({
  name: binaryFnNames(),
  type: literal(plugFnType),
  transformFn: object({
    a: object({ name: transformFnNames() }),
    b: object({ name: transformFnNames() }),
  }),
  args: object({
    a: union([funcInterfaceSchema, lazy(() => plugFuncSchema)]),
    b: union([funcInterfaceSchema, lazy(() => plugFuncSchema)]),
  }),
  return: object({ name: string(), type: any() }),
});

export const tapFuncSchema: GenericSchema<TapFunc> = object({
  name: string(),
  type: literal(tapFnType),
  steps: array(union([plugFuncSchema, lazy(() => tapFuncSchema)])),
  args: array(funcInterfaceSchema),
  return: object({
    name: nullable(string()),
    type: any(),
  }),
});
