import { executeGraph, isPureBoolean, buildNull } from "runtime";
import type { AnyValue, ValidatedContext } from "runtime";
import type { ActionModel, ProgModel } from "../types/turnout-model_pb.js";
import type { StateReader } from "../state/state-manager.js";
import type { ActionWarning, NextPolicy } from "../types/harness-types.js";
import { buildContextFromProg } from "./hcl-context-builder.js";
import type { BuiltContext } from "./hcl-context-builder.js";
import { resolveNextPrepare } from "./prepare-resolver.js";
import type { ActionExecutionResult } from "./types.js";

/** Maximum number of (prepared-values → context) entries kept per ProgModel in ruleCtxCache. */
const MAX_RULE_CTX_CACHE_ENTRIES = 256;

/** Maximum number of distinct ProgModel keys in the outer ruleCtxCache per executor. */
const MAX_RULE_CTX_CACHE_PROGS = 64;

/** Serialised prepare-key strings longer than this bypass the cache to avoid huge Map keys. */
const MAX_PREP_CACHE_KEY_BYTES = 65_536;

type NextRulesResult = { matches: string[]; warnings: ActionWarning[] };

type RuleCtxEntry = { builtCtx: BuiltContext; validCtx: ValidatedContext };

/**
 * Two-level FIFO cache for next-rule execution contexts, keyed by
 * (ProgModel identity, serialised prepared-values string).
 *
 * The inner Map evicts at MAX_RULE_CTX_CACHE_ENTRIES entries per ProgModel;
 * the outer Map evicts at MAX_RULE_CTX_CACHE_PROGS distinct ProgModels.
 * Eviction fires before the cap is exceeded so the size never exceeds the limit.
 */
export class RuleCtxCache {
  private readonly outer = new Map<ProgModel, Map<string, RuleCtxEntry>>();

  get(prog: ProgModel, key: string): RuleCtxEntry | undefined {
    return this.outer.get(prog)?.get(key);
  }

  set(prog: ProgModel, key: string, value: RuleCtxEntry): void {
    let inner = this.outer.get(prog);
    if (!inner) {
      inner = new Map();
      this.outer.set(prog, inner);
    }
    inner.set(key, value);
    // Evict the oldest inner entry (FIFO) so the size drops back to the cap.
    // The check fires after insertion, so size briefly reaches cap+1 before eviction.
    if (inner.size > MAX_RULE_CTX_CACHE_ENTRIES) {
      inner.delete(inner.keys().next().value!);
    }
    // Evict the oldest outer entry when the distinct-ProgModel count exceeds the cap.
    if (this.outer.size > MAX_RULE_CTX_CACHE_PROGS) {
      this.outer.delete(this.outer.keys().next().value!);
    }
  }
}

function makePreparedKey(prepared: Record<string, AnyValue>): string | null {
  const parts: string[] = [];
  // Object.keys() returns keys in insertion order (the proto's NextPrepareEntry
  // declaration order, which is stable and deterministic). No sort needed.
  for (const k of Object.keys(prepared)) {
    const v = prepared[k];
    let serialized: string;
    try {
      serialized = JSON.stringify(v?.value ?? null);
    } catch {
      // AnyValue.value should always be JSON-serializable (number, string,
      // boolean, or array). If serialization fails for a given entry, bypass
      // the cache so stale entries are never reused.
      return null;
    }
    parts.push(`${k}\x00${v?.symbol ?? "null"}\x00${serialized}`);
  }
  return parts.join("\x1f");
}

/**
 * Evaluate the next rules for a completed action and return the IDs of the
 * actions to enqueue, according to the scene's `next_policy`.
 *
 * For pure (no-inject) progs, `buildContextFromProg` handles caching via its
 * module-level `pureProgCtxCache`. For rules with prepare entries, a
 * per-invocation cache keyed by `(prog identity, serialised prepared values)`
 * avoids rebuilding identical contexts when multiple rules share the same prog
 * and produce equal prepared values (e.g. multiple guards on the same binding).
 * The cache is local to this call so stale values from previous actions are
 * never reused.
 *
 * `warnings` contains a diagnostic message for any condition binding that did
 * not resolve to a pure boolean — the rule is skipped but no error is thrown.
 */
export function evaluateNextRules(
  action: ActionModel,
  state: StateReader,
  result: ActionExecutionResult,
  policy: NextPolicy,
  signal: AbortSignal,
  sceneId: string,
  ruleCtxCache: RuleCtxCache,
): NextRulesResult {
  const rules = action.next ?? [];
  if (rules.length === 0) return { matches: [], warnings: [] };

  const matches: string[] = [];
  const warnings: ActionWarning[] = [];

  for (const rule of rules) {
    if (signal.aborted) throw new DOMException("Runner aborted", "AbortError");
    let condMet: boolean;

    if (!rule.compute) {
      // No compute block → unconditional match.
      condMet = true;
    } else if (rule.compute.prog) {
      const prepare = rule.prepare ?? [];
      const nextPrepared = resolveNextPrepare(prepare, state, result);

      let builtCtx: BuiltContext;
      let validated: ValidatedContext;
      if (prepare.length > 0) {
        // Non-pure: check per-executor cache before rebuilding. The key is a
        // compact encoding of the prepared-values map (see makePreparedKey).
        // Returns null when serialisation fails or the key is too large — bypass
        // the cache in those cases so stale entries are never reused.
        const prepKey = makePreparedKey(nextPrepared);
        const bypassCache = prepKey === null || prepKey.length > MAX_PREP_CACHE_KEY_BYTES;
        const cached = bypassCache ? undefined : ruleCtxCache.get(rule.compute.prog, prepKey!);
        if (cached) {
          ({ builtCtx, validCtx: validated } = cached);
        } else {
          builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
          validated = builtCtx.getValidatedExec();
          if (!bypassCache) {
            ruleCtxCache.set(rule.compute.prog, prepKey!, { builtCtx, validCtx: validated });
          }
        }
      } else {
        // Pure: buildContextFromProg already caches via pureProgCtxCache.
        builtCtx = buildContextFromProg(rule.compute.prog, nextPrepared, action.id);
        validated = builtCtx.getValidatedExec();
      }

      const conditionName = rule.compute.condition;
      const condBinding = builtCtx.resolve(conditionName);
      let condValue: AnyValue;
      if (condBinding.kind === "func") {
        condValue = executeGraph(condBinding.id, validated).value;
      } else if (condBinding.kind === "value") {
        condValue = (validated.valueTable[condBinding.id] as AnyValue) ?? buildNull("missing");
      } else {
        // kind === 'missing': condition binding not found in context
        condValue = buildNull("missing");
      }

      if (!isPureBoolean(condValue)) {
        const actualType = condValue?.symbol ?? "undefined";
        warnings.push({
          kind: "invalid_next_condition",
          actionId: action.id,
          conditionName,
          actualType,
          message:
            `action "${action.id}" next-rule condition "${conditionName}" resolved to ` +
            `${actualType} (expected pure boolean) — rule skipped`,
        });
      }
      condMet = isPureBoolean(condValue) && condValue.value;
    } else {
      warnings.push({
        kind: "missing_next_compute_prog",
        sceneId,
        actionId: action.id,
        targetActionId: rule.action,
        message:
          `scene "${sceneId}" action "${action.id}" next-rule targeting "${rule.action}": ` +
          `compute block has no prog — rule skipped (model may be malformed)`,
      });
      condMet = false;
    }

    if (condMet) {
      matches.push(rule.action);
      if (policy === "first-match") break;
    }
  }

  return { matches, warnings };
}
