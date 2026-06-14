import { ctx, combine, pipe, cond, ref as runtimeRef, buildArray, assertValidContext } from 'runtime';
import { SceneRuntimeError } from './errors.js';
import type { AnyValue, BinaryFnNames, ExecutionContext, ValidatedContext, FuncId, FuncTable, ValueId, ContextSpec } from 'runtime';
import { FN_MAP } from './fn-map.generated.js';

import type { ProgModel, BindingModel, ArgModel } from '../types/turnout-model_pb.js';
import { toCombineArgRef, toFuncId, toValueId } from './dynamic-boundary.js';
import type { LocalFuncOutputRef, LocalStepOutputRef, LocalTransformRef } from './dynamic-boundary.js';
import { literalToValue, protoValueToJs } from '../state/state-manager.js';


// ─────────────────────────────────────────────────────────────────────────────
// Pure-compute context cache
//
// When a prog has no injected values (no prepare entries), its ExecutionContext
// is fully determined by the ProgModel. We cache it keyed on ProgModel object
// identity so that repeated calls across turns (e.g. a stateless action executed
// on every turn) avoid rebuilding the context from scratch each time.
//
// Keyed by ProgModel *object identity*:
//   - Cache hits: same ProgModel object reused across calls — the typical case
//     when the TurnModel is loaded once at startup and kept in memory.
//   - Cache misses: JSON.parse on every request produces a fresh object graph;
//     the cache never hits, and each call pays the full build cost.
// Recommended pattern: parse the TurnModel once at startup and reuse the same
// reference across all runner invocations.
// ─────────────────────────────────────────────────────────────────────────────
let pureProgCtxCache = new WeakMap<ProgModel, BuiltContext>();

// Memoises the set of function-binding names per ProgModel. ProgModels are
// immutable after construction, so the set never changes; caching avoids the
// filter+map allocation on every ContextSpecBuilder construction.
let funcBindingNamesCache = new WeakMap<ProgModel, Set<string>>();

function clearContextCaches(): void {
  pureProgCtxCache = new WeakMap();
  funcBindingNamesCache = new WeakMap();
}

/**
 * Returns test-only hooks for this module. Import this via test-support.ts,
 * never from production code.
 */
export function _testHooks() {
  return { clearContextCaches };
}

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
   * Returns a pre-validated `ValidatedContext`, avoiding the need for callers
   * to call `assertValidContext(builtCtx.getExec())` as a separate step.
   * Validation runs once at context-build time and is cached here.
   */
  getValidatedExec(): ValidatedContext;
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


// FN_MAP is generated from spec/fn-aliases.json. To add a built-in, update
// spec/fn-aliases.json and run: node --experimental-strip-types scripts/gen-fn-map.ts
export { FN_MAP };

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
    // An empty array is acceptable here: the Go validator rejects [] as a
    // function argument (CodeEmptyArrayLitArg), so this path only fires for
    // value bindings whose type is already known to the runtime from the schema.
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
  // Deduplicates inline literal args: maps JSON-serialised literal → synthetic name.
  // Progs with repeated identity literals (e.g. 0 in multiple add(x, 0) calls)
  // share a single __lit_N binding instead of allocating one per occurrence.
  private readonly litCache = new Map<string, string>();
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
          `Re-compile the source with the current converter to fix this. ` +
          `(Earlier detection with an actionable error is available in migration.ts checkForExtExpr.)`,
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
      a: toCombineArgRef(this.resolveArg(c.args[0])),
      b: toCombineArgRef(this.resolveArg(c.args[1])),
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
        a: toCombineArgRef(this.resolveArg(step.args[0], binding.name)),
        b: toCombineArgRef(this.resolveArg(step.args[1], binding.name)),
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
      throw new SceneRuntimeError('CompilerBug', this.contextId,
        `${label} resolved to a non-string ref: ${JSON.stringify(result)} — ` +
        `this is a compiler bug; the Go validator rejects non-ref cond branches. ` +
        `Re-compile the source with the current converter to fix this.`);
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

  /** Resolves a `lit` arg, reusing an existing synthetic binding for identical literals. */
  private resolveLitArg(lit: unknown): string {
    const key = JSON.stringify(lit);
    const cached = this.litCache.get(key);
    if (cached !== undefined) return cached;
    const name = this.addLitBinding(lit);
    this.litCache.set(key, name);
    return name;
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
    if (arg.lit !== undefined) return this.resolveLitArg(arg.lit);
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
      nameToValueId.set(binding.name, funcTable[toFuncId(id as string)].returnId);
    } else {
      // Value binding: the id is the ValueId directly.
      nameToValueId.set(binding.name, toValueId(id as string));
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
 *
 * @remarks
 * Results are cached in `pureProgCtxCache` keyed by `ProgModel` object identity
 * when `injectedValues` is empty. The cache is only effective when the same
 * `ProgModel` reference is reused across calls — deserializing from JSON on each
 * request produces a fresh object and bypasses the cache entirely.
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
      ? { kind: 'func',  id: toFuncId(ids[name] as string) }
      : { kind: 'value', id: toValueId(ids[name] as string) };
  }
  const exec = result.exec;
  // Pre-validate once at build time so callers can use getValidatedExec() without
  // paying the assertValidContext cost on every call site.
  const validatedExec = assertValidContext(exec);
  const builtCtx: BuiltContext = {
    getExec: () => exec,
    getValidatedExec: () => validatedExec,
    resolveValueId: (name) => nameToValueId.get(name),
    resolve,
  };

  if (!hasInjected) pureProgCtxCache.set(prog, builtCtx);
  return builtCtx;
}
