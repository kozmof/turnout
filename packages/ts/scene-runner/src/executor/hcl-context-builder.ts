import { ctx, combine, pipe, cond, ref as runtimeRef, buildArray } from 'runtime';
import { SceneRuntimeError } from './errors.js';
import type { AnyValue, BinaryFnNames, ExecutionContext, FuncId, FuncTable, ValueId, ContextSpec } from 'runtime';

// Local structural aliases for builder API arg shapes. These mirror the types
// in runtime/src/compute-graph/builder/types.ts. They are not imported from
// 'runtime' because those types are not part of the public runtime API surface.
type LocalFuncOutputRef = { readonly __type: 'funcOutput'; readonly funcId: string };
type LocalStepOutputRef = { readonly __type: 'stepOutput'; readonly pipeFuncId: string; readonly stepIndex: number };
type LocalTransformRef  = { readonly __type: 'transform'; readonly valueRef: { readonly __type: 'value'; readonly id: string }; readonly transformFn: readonly string[] };
import type { ProgModel, BindingModel, ArgModel } from '../types/turnout-model_pb.js';
import { literalToValue, protoValueToJs } from '../state/state-manager.js';


// ─────────────────────────────────────────────────────────────────────────────
// Pure-compute context cache
//
// When a prog has no injected values (no prepare entries), its ExecutionContext
// is fully determined by the ProgModel. We cache it keyed on ProgModel object
// identity so that repeated calls across turns (e.g. a stateless action executed
// on every turn) avoid rebuilding the context from scratch each time.
//
// Keyed by ProgModel *object identity*. Cache only hits when the same
// ProgModel reference is reused across calls (e.g., the model is loaded
// once and kept in memory). Models deserialized from JSON on each call
// produce a new reference and will never hit this cache.
// ─────────────────────────────────────────────────────────────────────────────
const pureProgCtxCache = new WeakMap<ProgModel, BuiltContext>();

// Memoises the set of function-binding names per ProgModel. ProgModels are
// immutable after construction, so the set never changes; caching avoids the
// filter+map allocation on every ContextSpecBuilder construction.
const funcBindingNamesCache = new WeakMap<ProgModel, Set<string>>();

function getFuncBindingNames(prog: ProgModel): Set<string> {
  let s = funcBindingNamesCache.get(prog);
  if (!s) {
    s = new Set(prog.bindings.filter((b) => b.expr !== undefined).map((b) => b.name));
    funcBindingNamesCache.set(prog, s);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type BindingResolution =
  | { kind: 'func';    id: FuncId }
  | { kind: 'value';   id: ValueId }
  | { kind: 'missing' };

/** Sentinel returned by `resolve()` when the name is not in the context. */
export const MISSING_BINDING: BindingResolution = { kind: 'missing' };

export type BuiltContext = {
  /**
   * Returns the underlying ExecutionContext for passing to `assertValidContext`
   * or `executeGraph`. This is the only supported way to access the context
   * outside of this module; direct field access is intentionally absent.
   */
  getExec(): ExecutionContext;
  /**
   * @internal Binding name → ValueId for every binding.
   * Prefer `resolveValueId()` for external access — it is the stable public API.
   */
  nameToValueId: Map<string, ValueId>;
  /** Returns the ValueId for a binding name, or `undefined` when not found. */
  resolveValueId(name: string): ValueId | undefined;
  /**
   * Returns the resolution for a binding name.
   * Returns `{ kind: 'missing' }` when the name is not in the context.
   * Use `kind === 'func'` / `'value'` / `'missing'` for exhaustive handling.
   */
  resolve(name: string): BindingResolution;
};

// ─────────────────────────────────────────────────────────────────────────────
// Branded-type assertion helpers
//
// The ctx() builder is generic over a statically-known ContextSpec, so its
// return type encodes every key as a branded ID. When we build a spec from a
// dynamic proto model the type system cannot infer the specific keys, making
// unsafe casts unavoidable at this boundary. Concentrating them here makes the
// escape hatch explicit and keeps the rest of the bridge type-clean.
// ─────────────────────────────────────────────────────────────────────────────

function asFuncId(s: string): FuncId   { return s as FuncId; }
function asValueId(s: string): ValueId { return s as ValueId; }
// resolveArg returns unknown; callers that pass the result to combine() know the shape.
type CombineArgRef = Parameters<typeof combine>[1]['a'];
function asCombineArg(x: unknown): CombineArgRef { return x as CombineArgRef; }

// ─────────────────────────────────────────────────────────────────────────────
// HCL function name → runtime BinaryFnNames mapping
// ─────────────────────────────────────────────────────────────────────────────

// Authoritative source: spec/fn-aliases.json.
// Kept in sync with the Go builtinFnTable by tests/fn-map-coverage.test.ts.
// When adding a new built-in: update spec/fn-aliases.json first, then this map.
export const FN_MAP: Record<string, BinaryFnNames> = {
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
  arr_concat:    'binaryFnArray::concat',
  arr_get:       'binaryFnArray::get',
  arr_includes:  'binaryFnArray::includes',
};

function mapFnName(hclFn: string, contextId: string): BinaryFnNames {
  const mapped = FN_MAP[hclFn];
  if (!mapped) {
    throw new SceneRuntimeError(
      'UnknownFunction',
      contextId,
      `unknown HCL function name "${hclFn}" — no runtime mapping exists`,
    );
  }
  return mapped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Literal inference
// ─────────────────────────────────────────────────────────────────────────────

function inferLiteralAnyValue(lit: unknown, contextId: string): AnyValue {
  const v = protoValueToJs(lit);
  if (typeof v === 'number') return literalToValue(v, 'number');
  if (typeof v === 'string') return literalToValue(v, 'str');
  if (typeof v === 'boolean') return literalToValue(v, 'bool');
  if (Array.isArray(v)) {
    if (v.length === 0) return buildArray([]);
    const first = v[0];
    const firstType = typeof first;
    if (!v.every((e) => typeof e === firstType)) {
      throw new SceneRuntimeError(
        'UnknownArgModel',
        contextId,
        `heterogeneous array literal — all elements must share one JS type (first element is ${firstType})`,
      );
    }
    if (firstType === 'number') return literalToValue(v, 'arr<number>');
    if (firstType === 'string') return literalToValue(v, 'arr<str>');
    if (firstType === 'boolean') return literalToValue(v, 'arr<bool>');
  }
  throw new SceneRuntimeError(
    'UnknownArgModel',
    contextId,
    `unrecognized protobuf value kind for inline literal: ${typeof v}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: ProgModel → ContextSpec record
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the plain spec record consumed by the runtime `ctx()` builder from a
 * `ProgModel` and pre-resolved injected values.
 *
 * Encapsulated as a class so that each handler method can be unit-tested
 * independently and shared mutable state (`spec`, `litCounter`) is explicit.
 */
class ContextSpecBuilder {
  private spec: Record<string, unknown> = {};
  private litCounter = 0;
  // Pre-computed set of function-binding names (have expr). When a ref arg
  // points to a function binding, the builder API requires ref.output(name),
  // not a bare string (which looks up a non-existent direct value slot).
  private readonly functionBindingNames: Set<string>;

  constructor(
    private readonly prog: ProgModel,
    private readonly injectedValues: Record<string, AnyValue>,
    private readonly contextId: string,
  ) {
    this.functionBindingNames = getFuncBindingNames(prog);
  }

  build(): Record<string, unknown> {
    for (const binding of this.prog.bindings) {
      if (binding.extExpr !== undefined) {
        throw new SceneRuntimeError(
          'UnsupportedConstruct', this.contextId,
          `binding "${binding.name}": extExpr is a pre-lowering representation that must not appear in emitted JSON. ` +
          `This model may have been produced by a pre-release converter that did not lower #if/#case/#pipe expressions. ` +
          `Re-compile the source with the current converter to fix this.`,
        );
      }
      if (!binding.expr) {
        this.addValueBinding(binding);
      } else {
        this.addFuncBinding(binding);
      }
    }
    return this.spec;
  }

  private addValueBinding(binding: BindingModel): void {
    const injected = this.injectedValues[binding.name];
    if (injected !== undefined) {
      this.spec[binding.name] = injected;
      return;
    }
    if (binding.value === undefined) {
      throw new SceneRuntimeError(
        'CompilerBug', this.contextId,
        `binding "${binding.name}": value binding has no value field — compiler bug or malformed JSON`,
      );
    }
    this.spec[binding.name] = literalToValue(binding.value, binding.type);
  }

  private addFuncBinding(binding: BindingModel): void {
    const expr = binding.expr!;
    if (expr.combine) {
      this.handleCombineBinding(binding);
    } else if (expr.pipe) {
      this.handlePipeBinding(binding);
    } else if (expr.cond) {
      this.handleCondBinding(binding);
    } else {
      throw new SceneRuntimeError('UnknownArgModel', this.contextId,
        `binding "${binding.name}": unrecognized expr variant`);
    }
  }

  private handleCombineBinding(binding: BindingModel): void {
    const c = binding.expr!.combine!;
    if (c.args.length < 2) {
      throw new SceneRuntimeError(
        'CompilerBug', this.contextId,
        `binding "${binding.name}": combine expr has ${c.args.length} arg(s); expected 2 — malformed model`,
      );
    }
    this.spec[binding.name] = combine(mapFnName(c.fn, this.contextId), {
      a: asCombineArg(this.resolveArg(c.args[0])),
      b: asCombineArg(this.resolveArg(c.args[1])),
    });
  }

  private handlePipeBinding(binding: BindingModel): void {
    const p = binding.expr!.pipe!;
    const argBindings: Record<string, string> = {};
    for (const param of p.params) {
      argBindings[param.paramName] = param.sourceIdent;
    }
    const steps = p.steps.map((step, i) => {
      if (step.args.length < 2) {
        throw new SceneRuntimeError(
          'UnknownArgModel', this.contextId,
          `binding "${binding.name}" pipe step ${i} ("${step.fn}") has ${step.args.length} arg(s); expected 2`,
        );
      }
      return combine(mapFnName(step.fn, this.contextId), {
        a: asCombineArg(this.resolveArg(step.args[0], binding.name)),
        b: asCombineArg(this.resolveArg(step.args[1], binding.name)),
      });
    });
    this.spec[binding.name] = pipe(argBindings, steps);
  }

  private handleCondBinding(binding: BindingModel): void {
    const c = binding.expr!.cond!;
    const conditionRef = c.condition ? this.resolveCondArg(c.condition) : '';
    const thenRef = c.then ? this.resolveAsRef(c.then, 'cond then-branch') : '';
    const elseRef = c.elseBranch ? this.resolveAsRef(c.elseBranch, 'cond else-branch') : '';
    this.spec[binding.name] = cond(conditionRef, { then: thenRef, else: elseRef });
  }

  private resolveAsRef(arg: ArgModel, label: string): string {
    const result = this.resolveArg(arg);
    if (typeof result !== 'string') {
      throw new SceneRuntimeError('UnknownArgModel', this.contextId,
        `${label} resolved to a non-string ref (got ${typeof result}) — expected ref or funcRef`);
    }
    return result;
  }

  /**
   * Dispatch an ArgModel to its typed resolver. Returns `unknown` so the
   * caller can apply `asCombineArg` at the builder API boundary; each
   * individual variant is resolved by a typed private method below.
   */
  private resolveArg(arg: ArgModel, currentPipeName?: string): unknown {
    if (arg.ref !== undefined) return this.resolveRefArg(arg.ref);
    if (arg.funcRef !== undefined) return arg.funcRef;
    if (arg.lit !== undefined) return this.resolveLitArg(arg.lit);
    if (arg.stepRef !== undefined) return this.resolveStepRefArg(arg.stepRef, currentPipeName);
    if (arg.transform !== undefined) return this.resolveTransformArg(arg.transform);
    throw new SceneRuntimeError('UnknownArgModel', this.contextId, 'unknown ArgModel variant encountered in hcl-context-builder');
  }

  /** Resolves a `ref` arg: plain string for value bindings, FuncOutputRef for function bindings. */
  private resolveRefArg(ref: string): string | LocalFuncOutputRef {
    // Function-binding outputs must be referenced via ref.output(), not as a
    // bare string (which looks up a value slot that doesn't exist for funcs).
    return this.functionBindingNames.has(ref) ? runtimeRef.output(ref) : ref;
  }

  /** Resolves a `lit` arg by registering a synthetic value binding and returning its name. */
  private resolveLitArg(lit: unknown): string {
    return this.addLitBinding(lit);
  }

  /** Resolves a `stepRef` arg to a StepOutputRef shape expected by the pipe builder API. */
  private resolveStepRefArg(stepRef: number, currentPipeName: string | undefined): LocalStepOutputRef {
    if (!currentPipeName) throw new SceneRuntimeError('UnknownArgModel', this.contextId, 'step_ref used outside of pipe context');
    return { __type: 'stepOutput', pipeFuncId: currentPipeName, stepIndex: stepRef };
  }

  /** Resolves a `transform` arg to a TransformRef shape expected by the combine builder API. */
  private resolveTransformArg(transform: NonNullable<ArgModel['transform']>): LocalTransformRef {
    return {
      __type: 'transform',
      valueRef: { __type: 'value', id: transform.ref },
      transformFn: transform.fn,
    };
  }

  // `cond()` accepts a binding id for the condition. The runtime builder then
  // decides whether that id names a value binding or a function binding.
  private resolveCondArg(arg: ArgModel): string {
    if (arg.ref !== undefined) return arg.ref;
    if (arg.funcRef !== undefined) return arg.funcRef;
    if (arg.lit !== undefined) return this.addLitBinding(arg.lit);
    if (arg.stepRef !== undefined)
      throw new SceneRuntimeError('UnknownArgModel', this.contextId, 'cond condition cannot be a step reference');
    if (arg.transform !== undefined)
      throw new SceneRuntimeError('UnknownArgModel', this.contextId, 'cond condition cannot be a transform reference');
    throw new SceneRuntimeError('UnknownArgModel', this.contextId, 'cond condition must resolve to a value or function binding');
  }

  // Register a synthetic value binding for an inline literal arg.
  private addLitBinding(lit: unknown): string {
    const name = `__lit_${this.litCounter++}`;
    this.spec[name] = inferLiteralAnyValue(lit, this.contextId);
    return name;
  }
}

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
  contextId = '(unknown)',
): Record<string, unknown> {
  return new ContextSpecBuilder(prog, injectedValues, contextId).build();
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
  funcTable: FuncTable,
  contextId = '(unknown)',
): Map<string, ValueId> {
  const nameToValueId = new Map<string, ValueId>();
  for (const binding of bindings) {
    const id = ids[binding.name];
    if (id === undefined) {
      throw new SceneRuntimeError(
        'UnknownArgModel',
        contextId,
        `binding "${binding.name}" not found in context ID map — this is a compiler bug`,
      );
    }
    if (binding.expr) {
      // Function binding: the result lives in the function's return value slot.
      nameToValueId.set(binding.name, funcTable[asFuncId(id as string)].returnId);
    } else {
      // Value binding: the id is the ValueId directly.
      nameToValueId.set(binding.name, asValueId(id as string));
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
 *
 * `contextId` is included in any `SceneRuntimeError` thrown during context
 * construction (e.g. unknown HCL function names). Pass the action ID so errors
 * surface the actual source rather than the generic `'(unknown)'` placeholder.
 */
export function buildContextFromProg(
  prog: ProgModel,
  injectedValues: Record<string, AnyValue>,
  contextId = '(unknown)',
): BuiltContext {
  const hasInjected = Object.keys(injectedValues).length > 0;
  if (!hasInjected) {
    const cached = pureProgCtxCache.get(prog);
    if (cached) return cached;
  }

  const spec = buildSpec(prog, injectedValues, contextId);
  const result = ctx(spec as ContextSpec); // dynamic spec — branded keys unavailable statically
  const ids = result.ids as Record<string, FuncId | ValueId>; // see asFuncId/asValueId above
  const funcTable = result.exec.funcTable;
  const nameToValueId = buildNameToValueId(prog.bindings, ids, funcTable, contextId);
  const funcBindingNames = getFuncBindingNames(prog);
  function resolve(name: string): BindingResolution {
    if (!Object.prototype.hasOwnProperty.call(ids, name)) return MISSING_BINDING;
    return funcBindingNames.has(name)
      ? { kind: 'func',  id: asFuncId(ids[name] as string) }
      : { kind: 'value', id: asValueId(ids[name] as string) };
  }
  const exec = result.exec;
  const builtCtx: BuiltContext = { getExec: () => exec, nameToValueId, resolveValueId: (name) => nameToValueId.get(name), resolve };

  if (!hasInjected) pureProgCtxCache.set(prog, builtCtx);
  return builtCtx;
}
