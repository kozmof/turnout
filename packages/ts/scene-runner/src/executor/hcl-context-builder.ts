import { ctx, combine, pipe, cond, ref as runtimeRef, buildArray } from 'runtime';
import type { AnyValue, ExecutionContext, FuncId, ValueId, ContextSpec } from 'runtime';
import type { ProgModel, ArgModel } from '../types/turnout-model_pb.js';
import { literalToValue, protoValueToJs } from '../state/state-manager.js';

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

function inferLiteralAnyValue(lit: unknown): AnyValue {
  const v = protoValueToJs(lit);
  if (typeof v === 'number') return literalToValue(v, 'number');
  if (typeof v === 'string') return literalToValue(v, 'str');
  if (typeof v === 'boolean') return literalToValue(v, 'bool');
  if (Array.isArray(v)) {
    const first = v[0];
    if (typeof first === 'number') return literalToValue(v, 'arr<number>');
    if (typeof first === 'string') return literalToValue(v, 'arr<str>');
    if (typeof first === 'boolean') return literalToValue(v, 'arr<bool>');
    // Empty array — no element type to infer; return a typed empty array value.
    return buildArray([]);
  }
  return literalToValue(null, 'number');
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: ProgModel → ContextSpec record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translate a `ProgModel` and pre-resolved injected values into the plain spec
 * record consumed by the runtime `ctx()` builder.
 *
 * Exported for unit testing — the returned record can be inspected without
 * running `ctx()` or `executeGraph`.
 */
export function buildSpec(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {};
  let litCounter = 0;

  // Pre-compute which binding names are function bindings (have expr).
  // When a ref arg points to a function binding, the builder API requires
  // ref.output(name) to reference the function's return value, not a plain
  // string (which would look up a non-existent direct value slot).
  const functionBindingNames = new Set(
    prog.bindings.filter((b) => b.expr !== undefined).map((b) => b.name),
  );

  // Register a synthetic value binding for an inline literal arg.
  function addLitBinding(lit: unknown): string {
    const name = `__lit_${litCounter++}`;
    spec[name] = inferLiteralAnyValue(lit);
    return name;
  }

  // Resolve an ArgModel to the appropriate reference type for the builder API.
  function resolveArg(arg: ArgModel, currentPipeName?: string): unknown {
    if (arg.ref !== undefined) {
      // Function-binding outputs must be referenced via ref.output(), not as a
      // bare string (which looks up a value slot that doesn't exist for funcs).
      return functionBindingNames.has(arg.ref) ? runtimeRef.output(arg.ref) : arg.ref;
    }
    if (arg.funcRef !== undefined) return arg.funcRef;
    if (arg.lit !== undefined) return addLitBinding(arg.lit);
    if (arg.stepRef !== undefined) {
      if (!currentPipeName) throw new Error('step_ref used outside of pipe context');
      return { __type: 'stepOutput', pipeFuncId: currentPipeName, stepIndex: arg.stepRef };
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
        argBindings[param.paramName] = param.sourceIdent;
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
      const elseRef = c.elseBranch ? (resolveArg(c.elseBranch) as string) : '';
      spec[binding.name] = cond(conditionRef, { then: thenRef, else: elseRef });
    }
  }

  return spec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ids + funcTable → nameToValueId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a binding-name → ValueId map from the IDs and funcTable produced by
 * `ctx()`.
 *
 * For value bindings the id IS the ValueId. For function bindings the result
 * lives in the function's return value slot (`funcTable[id].returnId`).
 *
 * Exported for unit testing — can be exercised with synthetic ids/funcTable
 * without constructing a full ExecutionContext.
 */
export function buildNameToValueId(
  bindings: ProgModel['bindings'],
  ids: Record<string, FuncId | ValueId>,
  funcTable: Record<string, { returnId: ValueId }>,
): Record<string, ValueId> {
  const nameToValueId: Record<string, ValueId> = {};
  for (const binding of bindings) {
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
  return nameToValueId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public builder — orchestrates the two phases
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
  const spec = buildSpec(prog, injectedValues);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const result = ctx(spec as ContextSpec);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const ids = result.ids as Record<string, FuncId | ValueId>;
  // funcTable is indexed by branded FuncId but at runtime the keys are strings.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const funcTable = result.exec.funcTable as unknown as Record<string, { returnId: ValueId }>;
  return { exec: result.exec, ids, nameToValueId: buildNameToValueId(prog.bindings, ids, funcTable) };
}
