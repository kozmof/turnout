import { combine, pipe, cond, ref as runtimeRef } from "runtime";
import type { AnyValue, BinaryFnNames } from "runtime";
import type { ProgModel, BindingModel, ArgModel } from "../types/turnout-model_pb.js";
import { toCombineArgRef, assertArgModelVariant } from "./dynamic-boundary.js";
import type {
  LocalFuncOutputRef,
  LocalStepOutputRef,
  LocalTransformRef,
} from "./dynamic-boundary.js";
import { SceneRuntimeError } from "./errors.js";
import { getFuncBindingNames } from "./hcl-cache.js";
import { inferLiteralAnyValue } from "./hcl-literal.js";
import { literalToValue } from "../state/state-manager.js";
import { FN_MAP } from "./fn-map.generated.js";

function mapFnName(hclFn: string, contextId: string): BinaryFnNames {
  const mapped = FN_MAP[hclFn];
  if (!mapped) {
    throw new SceneRuntimeError(
      "UnknownFunction",
      contextId,
      `unknown HCL function name "${hclFn}" — no runtime mapping exists`,
    );
  }
  return mapped;
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
export class ContextSpecBuilder {
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
          "UnsupportedConstruct",
          this.contextId,
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
        "CompilerBug",
        this.contextId,
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
      throw new SceneRuntimeError(
        "UnknownArgModel",
        this.contextId,
        `binding "${binding.name}": unrecognized expr variant`,
      );
    }
  }

  private handleCombineBinding(binding: BindingModel): void {
    const c = binding.expr!.combine!;
    if (c.args.length !== 2) {
      throw new SceneRuntimeError(
        "CompilerBug",
        this.contextId,
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
      if (step.args.length !== 2) {
        throw new SceneRuntimeError(
          "UnknownArgModel",
          this.contextId,
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
    if (!c.condition) {
      throw new SceneRuntimeError(
        "CompilerBug",
        this.contextId,
        `binding "${binding.name}": cond expr is missing condition — malformed model`,
      );
    }
    if (!c.then) {
      throw new SceneRuntimeError(
        "CompilerBug",
        this.contextId,
        `binding "${binding.name}": cond expr is missing then branch — malformed model`,
      );
    }
    if (!c.elseBranch) {
      throw new SceneRuntimeError(
        "CompilerBug",
        this.contextId,
        `binding "${binding.name}": cond expr is missing else branch — malformed model`,
      );
    }
    const conditionRef = this.resolveCondArg(c.condition);
    const thenRef = this.resolveAsRef(c.then, "cond then-branch");
    const elseRef = this.resolveAsRef(c.elseBranch, "cond else-branch");
    // eslint-disable-next-line unicorn/no-thenable -- `then` is a required param name in the runtime cond() API, not a Promise thenable
    this.spec[binding.name] = cond(conditionRef, { then: thenRef, else: elseRef });
  }

  private resolveAsRef(arg: ArgModel, label: string): string {
    const result = this.resolveArg(arg);
    if (typeof result !== "string") {
      throw new SceneRuntimeError(
        "CompilerBug",
        this.contextId,
        `${label} resolved to a non-string ref: ${JSON.stringify(result)} — ` +
          `this is a compiler bug; the Go validator rejects non-ref cond branches. ` +
          `Re-compile the source with the current converter to fix this.`,
      );
    }
    return result;
  }

  /**
   * Dispatch an ArgModel to its typed resolver. Returns `unknown` so the
   * caller can apply `asCombineArg` at the builder API boundary; each
   * individual variant is resolved by a typed private method below.
   */
  private resolveArg(arg: ArgModel, currentPipeName?: string): unknown {
    assertArgModelVariant(arg, this.contextId, "ArgModel");
    if (arg.ref !== undefined) return this.resolveRefArg(arg.ref);
    if (arg.funcRef !== undefined) return arg.funcRef;
    if (arg.lit !== undefined) return this.resolveLitArg(arg.lit);
    if (arg.stepRef !== undefined) return this.resolveStepRefArg(arg.stepRef, currentPipeName);
    if (arg.transform !== undefined) return this.resolveTransformArg(arg.transform);
    throw new SceneRuntimeError(
      "UnknownArgModel",
      this.contextId,
      "unknown ArgModel variant encountered in hcl-spec-builder",
    );
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
  private resolveStepRefArg(
    stepRef: number,
    currentPipeName: string | undefined,
  ): LocalStepOutputRef {
    if (!currentPipeName)
      throw new SceneRuntimeError(
        "UnknownArgModel",
        this.contextId,
        "step_ref used outside of pipe context",
      );
    return { __type: "stepOutput", pipeFuncId: currentPipeName, stepIndex: stepRef };
  }

  /** Resolves a `transform` arg to a TransformRef shape expected by the combine builder API. */
  private resolveTransformArg(transform: NonNullable<ArgModel["transform"]>): LocalTransformRef {
    return {
      __type: "transform",
      valueRef: { __type: "value", id: transform.ref },
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
      throw new SceneRuntimeError(
        "UnknownArgModel",
        this.contextId,
        "cond condition cannot be a step reference",
      );
    if (arg.transform !== undefined)
      throw new SceneRuntimeError(
        "UnknownArgModel",
        this.contextId,
        "cond condition cannot be a transform reference",
      );
    throw new SceneRuntimeError(
      "UnknownArgModel",
      this.contextId,
      "cond condition must resolve to a value or function binding",
    );
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
  contextId = "(unknown)",
): Record<string, unknown> {
  return new ContextSpecBuilder(prog, injectedValues, contextId).build();
}
