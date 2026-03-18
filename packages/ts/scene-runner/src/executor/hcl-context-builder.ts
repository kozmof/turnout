import { ctx, combine, pipe, cond } from 'turnout';
import type { AnyValue, ExecutionContext, FuncId, ValueId, ContextSpec } from 'turnout';
import type { ProgModel, ArgModel, Literal } from '../types/scene-model.js';
import { literalToValue } from '../state/state-manager.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type BuiltContext = {
  exec: ExecutionContext;
  /** Binding name → FuncId (function binding) or ValueId (value binding). */
  ids: Record<string, FuncId | ValueId>;
  /** Binding name → ValueId for every binding. Used for from_action lookup. */
  nameToValueId: Record<string, ValueId>;
};

// ─────────────────────────────────────────────────────────────────────────────
// HCL function name → runtime BinaryFnNames mapping
// ─────────────────────────────────────────────────────────────────────────────

const FN_MAP: Record<string, string> = {
  // Number arithmetic
  add: 'binaryFnNumber::add',
  sub: 'binaryFnNumber::minus',
  mul: 'binaryFnNumber::multiply',
  div: 'binaryFnNumber::divide',
  mod: 'binaryFnNumber::mod',
  max: 'binaryFnNumber::max',
  min: 'binaryFnNumber::min',
  // Number comparison
  gt:  'binaryFnNumber::greaterThan',
  gte: 'binaryFnNumber::greaterThanOrEqual',
  lt:  'binaryFnNumber::lessThan',
  lte: 'binaryFnNumber::lessThanOrEqual',
  // Boolean
  bool_and: 'binaryFnBoolean::and',
  bool_or:  'binaryFnBoolean::or',
  bool_xor: 'binaryFnBoolean::xor',
  // String
  str_concat:   'binaryFnString::concat',
  str_includes: 'binaryFnString::includes',
  str_starts:   'binaryFnString::startsWith',
  str_ends:     'binaryFnString::endsWith',
  // Generic equality
  eq:  'binaryFnGeneric::isEqual',
  neq: 'binaryFnGeneric::isNotEqual',
  // Array
  arr_concat: 'binaryFnArray::concat',
};

function mapFnName(hclFn: string): Parameters<typeof combine>[0] {
  const mapped = FN_MAP[hclFn];
  if (!mapped) throw new Error(`Unknown HCL function name: "${hclFn}"`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return mapped as Parameters<typeof combine>[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Literal inference
// ─────────────────────────────────────────────────────────────────────────────

function inferLiteralAnyValue(lit: Literal): AnyValue {
  if (typeof lit === 'number') return literalToValue(lit, 'number');
  if (typeof lit === 'string') return literalToValue(lit, 'str');
  if (typeof lit === 'boolean') return literalToValue(lit, 'bool');
  if (Array.isArray(lit)) {
    const first = lit[0];
    if (typeof first === 'number') return literalToValue(lit, 'arr<number>');
    if (typeof first === 'string') return literalToValue(lit, 'arr<str>');
    if (typeof first === 'boolean') return literalToValue(lit, 'arr<bool>');
  }
  return literalToValue(null, 'number');
}

// ─────────────────────────────────────────────────────────────────────────────
// Core builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a `ProgModel` and a map of pre-resolved injected values into an
 * `ExecutionContext` ready for `assertValidContext` + `executeGraph`.
 *
 * `injectedValues` are values resolved by the prepare resolver (from_state,
 * from_action, from_hook). They override the binding's declared literal default.
 */
export function buildContextFromProg(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>,
): BuiltContext {
  // We build the spec as a plain record and cast it to ContextSpec before
  // passing to ctx(), since we construct it dynamically.
  const spec: Record<string, unknown> = {};
  let litCounter = 0;

  // Register a synthetic value binding for an inline literal arg.
  function addLitBinding(lit: Literal): string {
    const name = `__lit_${litCounter++}`;
    spec[name] = inferLiteralAnyValue(lit);
    return name;
  }

  // Resolve an ArgModel to the appropriate reference type for the builder API.
  function resolveArg(arg: ArgModel, currentPipeName?: string): unknown {
    if (arg.ref !== undefined) return arg.ref;
    if (arg.func_ref !== undefined) return arg.func_ref;
    if (arg.lit !== undefined) return addLitBinding(arg.lit);
    if (arg.step_ref !== undefined) {
      if (!currentPipeName) throw new Error('step_ref used outside of pipe context');
      return { __type: 'stepOutput', pipeFuncId: currentPipeName, stepIndex: arg.step_ref };
    }
    if (arg.transform !== undefined) {
      return {
        __type: 'transform',
        valueRef: { __type: 'value', id: arg.transform.ref },
        transformFn: arg.transform.fn,
      };
    }
    throw new Error('Unknown ArgModel variant encountered in hcl-context-builder');
  }

  // Process each binding in declaration order (converter guarantees topological order).
  for (const binding of prog.bindings) {
    if (!binding.expr) {
      // Value binding: use injected value if present, otherwise use the literal default.
      const injected = injectedValues[binding.name];
      spec[binding.name] =
        injected !== undefined ? injected : literalToValue(binding.value!, binding.type);
    } else if (binding.expr.combine) {
      const c = binding.expr.combine;
      spec[binding.name] = combine(mapFnName(c.fn), {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        a: resolveArg(c.args[0]) as Parameters<typeof combine>[1]['a'],
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        b: resolveArg(c.args[1]) as Parameters<typeof combine>[1]['b'],
      });
    } else if (binding.expr.pipe) {
      const p = binding.expr.pipe;
      const argBindings: Record<string, string> = {};
      for (const param of p.params) {
        argBindings[param.param_name] = param.source_ident;
      }
      const steps = p.steps.map((step) =>
        combine(mapFnName(step.fn), {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          a: resolveArg(step.args[0], binding.name) as Parameters<typeof combine>[1]['a'],
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          b: resolveArg(step.args[1], binding.name) as Parameters<typeof combine>[1]['b'],
        }),
      );
      spec[binding.name] = pipe(argBindings, steps);
    } else if (binding.expr.cond) {
      const c = binding.expr.cond;
      const conditionRef = c.condition ? (resolveArg(c.condition) as string) : '';
      const thenRef = c.then ? (resolveArg(c.then) as string) : '';
      const elseRef = c.else ? (resolveArg(c.else) as string) : '';
      spec[binding.name] = cond(conditionRef, { then: thenRef, else: elseRef });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const result = ctx(spec as ContextSpec);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const ids = result.ids as Record<string, FuncId | ValueId>;

  // funcTable is indexed by branded FuncId but at runtime the keys are strings.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const funcTable = result.exec.funcTable as unknown as Record<string, { returnId: ValueId }>;

  // Derive nameToValueId: map every binding name to its computed ValueId.
  const nameToValueId: Record<string, ValueId> = {};
  for (const binding of prog.bindings) {
    const id = ids[binding.name];
    if (binding.expr) {
      // Function binding: the result lives in the function's return value slot.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      nameToValueId[binding.name] = funcTable[id as string].returnId;
    } else {
      // Value binding: the id is the ValueId directly.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      nameToValueId[binding.name] = id as ValueId;
    }
  }

  return { exec: result.exec, ids, nameToValueId };
}
