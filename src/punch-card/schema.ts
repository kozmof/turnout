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
import { PlugFuncType, PlugFunc, TapFuncType, TapFunc } from './types';
import { transformFnNames } from './literal-schema/transformFnNames';

const plugFuncType: PlugFuncType = 'plug';
const tapFuncType: TapFuncType = 'tap';

const funcInterfaceSchema = object({
  name: string(),
  type: any(),
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
  return: object({ name: string(), type: any() }),
});

export const tapFuncSchema: GenericSchema<TapFunc> = object({
  name: string(),
  type: literal(tapFuncType),
  steps: array(union([plugFuncSchema, lazy(() => tapFuncSchema)])),
  args: array(funcInterfaceSchema),
  return: object({
    name: nullable(string()),
    type: any(),
  }),
});
