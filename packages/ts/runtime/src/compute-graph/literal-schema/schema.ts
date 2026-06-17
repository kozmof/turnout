import {
  array,
  boolean,
  GenericSchema,
  lazy,
  literal,
  null_,
  number,
  object,
  string,
  undefined_,
  union,
  variant,
} from "valibot";
import { binaryFnNames } from "./binaryFnNames.js";
import { CombineFuncType, CombineFunc, PipeFuncType, PipeFunc } from "./input-types.js";
import { transformFnNames } from "./transformFnNames.js";
import { nullReasonSubSymbols } from "../../state-control/value.js";
import type { AnyValue } from "../../state-control/value.js";

const combineFuncType: CombineFuncType = "combine";
const pipeFuncType: PipeFuncType = "pipe";

const nullReasonLiterals = nullReasonSubSymbols.map((symbol) => literal(symbol));

const numberValueSchema = object({
  symbol: literal("number"),
  subSymbol: undefined_(),
  value: number(),
  tags: array(string()),
});
const stringValueSchema = object({
  symbol: literal("string"),
  subSymbol: undefined_(),
  value: string(),
  tags: array(string()),
});
const booleanValueSchema = object({
  symbol: literal("boolean"),
  subSymbol: undefined_(),
  value: boolean(),
  tags: array(string()),
});
const nullValueSchema = object({
  symbol: literal("null"),
  subSymbol: union(nullReasonLiterals),
  value: null_(),
  tags: array(string()),
});

function recursiveValueSchema(): GenericSchema<AnyValue> {
  // Valibot cannot infer this self-recursive schema precisely. Keep the cast
  // local to the recursion boundary so exported schemas still expose AnyValue.
  return lazy(() =>
    variant("symbol", [
      numberValueSchema,
      stringValueSchema,
      booleanValueSchema,
      nullValueSchema,
      object({
        symbol: literal("array"),
        subSymbol: undefined_(),
        value: array(lazy(() => anyValueSchema)),
        tags: array(string()),
      }),
      object({
        symbol: literal("array"),
        subSymbol: literal("number"),
        value: array(numberValueSchema),
        tags: array(string()),
      }),
      object({
        symbol: literal("array"),
        subSymbol: literal("string"),
        value: array(stringValueSchema),
        tags: array(string()),
      }),
      object({
        symbol: literal("array"),
        subSymbol: literal("boolean"),
        value: array(booleanValueSchema),
        tags: array(string()),
      }),
      object({
        symbol: literal("array"),
        subSymbol: literal("null"),
        value: array(nullValueSchema),
        tags: array(string()),
      }),
    ]),
  ) as unknown as GenericSchema<AnyValue>;
}

const anyValueSchema = lazy(() => recursiveValueSchema());

const funcInterfaceSchema = object({
  name: string(),
  type: literal("value"),
  value: anyValueSchema,
});

// These schemas validate literal graph shape only. Function/type compatibility
// is checked later by compute-graph validation and execution.
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
