/**
 * Host conformance: every vector in spec/conformance/host, run against the
 * TypeScript host.
 *
 * The vectors are data, not TypeScript. They describe a model, a STATE, what
 * each hook is handed and answers with, and what the run must produce — in the
 * canonical tagged-Value encoding the ABI already speaks, with no assertion on
 * any wording. That is what makes them a contract two hosts can both be held
 * to rather than a description of this one.
 *
 * `spec/capabilities.json` claims the TypeScript host supports each capability.
 * This file is that claim's evidence; `scripts/check-capabilities.mjs` checks
 * that no capability is claimed without any.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { runZigServerHarness as runHarness } from "./zig-harness.js";
import { fromCanonicalValue, toCanonicalValue } from "turnout-runtime/zig-runtime";
import type { AnyValue } from "turnout-runtime";
import type {
  ActionTrace,
  ExecutionTrace,
  HookRegistry,
  PublishHookOutcome,
} from "../../src/types/harness-types.js";

type Canonical = Record<string, unknown>;

type PrepareHookScript = {
  expectContext?: Record<string, Canonical>;
  returns?: Record<string, Canonical>;
  fails?: string;
};

type PublishHookScript = {
  expectState?: Record<string, Canonical>;
  status: "ok" | "error";
  message?: string;
};

type ExtendHookScript = { returnsModel: string };

type Vector = {
  name: string;
  why: string;
  model: string;
  entryId: string;
  initialState?: Record<string, Canonical>;
  hooks?: {
    prepare?: Record<string, PrepareHookScript>;
    publish?: Record<string, PublishHookScript>;
    extend?: Record<string, ExtendHookScript>;
  };
  expect: {
    actions?: Array<{ actionId: string; publishOutcomes?: PublishHookOutcome[] }>;
    finalState?: Record<string, Canonical>;
    error?: { code: string; actionId?: string };
  };
};

const repoRoot = resolve(__dirname, "../../../../..");
const vectorDir = resolve(repoRoot, "spec/conformance/host");

function loadSuites(): Array<{ file: string; capability: string; vectors: Vector[] }> {
  return (
    readdirSync(vectorDir)
      .filter((name) => name.endsWith(".json"))
      // eslint-disable-next-line unicorn/no-array-sort -- readdirSync returns a fresh array
      .sort()
      .map((file) => ({
        file,
        ...(JSON.parse(readFileSync(resolve(vectorDir, file), "utf8")) as {
          capability: string;
          vectors: Vector[];
        }),
      }))
  );
}

function decodeState(values: Record<string, Canonical> | undefined): Record<string, AnyValue> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([path, value]) => [path, fromCanonicalValue(value)]),
  );
}

function encodeState(values: Record<string, AnyValue>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([path, value]) => [path, toCanonicalValue(value)]),
  );
}

/** Every action trace in the run, in the order the actions completed. */
function actionTraces(trace: ExecutionTrace): ActionTrace[] {
  if (trace.kind === "scene") return [...trace.scene.actions];
  return trace.route.scenes.flatMap((scene) => [...scene.actions]);
}

/**
 * Builds the hook registry a vector describes, and collects what each hook was
 * handed so the caller can assert on it after the run rather than inside it —
 * an expectation thrown from a hook would surface as a hook failure.
 */
function scriptedHooks(vector: Vector): {
  hooks: HookRegistry;
  mismatches: string[];
} {
  const mismatches: string[] = [];
  const hooks: HookRegistry = {
    prepare: Object.create(null) as HookRegistry["prepare"],
    extend: Object.create(null) as HookRegistry["extend"],
    publish: Object.create(null) as HookRegistry["publish"],
  };

  for (const [name, script] of Object.entries(vector.hooks?.prepare ?? {})) {
    hooks.prepare[name] = (context) => {
      for (const [binding, expected] of Object.entries(script.expectContext ?? {})) {
        const seen = context.get(binding);
        const actual = seen === undefined ? undefined : toCanonicalValue(seen as AnyValue);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          mismatches.push(
            `prepare hook "${name}" saw ${binding}=${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
          );
        }
      }
      if (script.fails !== undefined) throw new Error(script.fails);
      return Object.fromEntries(
        Object.entries(script.returns ?? {}).map(([binding, value]) => [
          binding,
          fromCanonicalValue(value),
        ]),
      );
    };
  }

  for (const [name, script] of Object.entries(vector.hooks?.publish ?? {})) {
    hooks.publish[name] = (context) => {
      const state = encodeState(context.state() as Record<string, AnyValue>);
      for (const [path, expected] of Object.entries(script.expectState ?? {})) {
        if (JSON.stringify(state[path]) !== JSON.stringify(expected)) {
          mismatches.push(
            `publish hook "${name}" saw ${path}=${JSON.stringify(state[path])}, expected ${JSON.stringify(expected)}`,
          );
        }
      }
      return script.status === "error"
        ? { hookName: name, status: "error", message: script.message ?? "" }
        : undefined;
    };
  }

  for (const [name, script] of Object.entries(vector.hooks?.extend ?? {})) {
    hooks.extend[name] = () =>
      JSON.parse(readFileSync(resolve(repoRoot, script.returnsModel), "utf8"));
  }

  return { hooks, mismatches };
}

for (const suite of loadSuites()) {
  describe(`host conformance — ${suite.capability}`, () => {
    for (const vector of suite.vectors) {
      it(`${vector.name.replaceAll("-", " ")} (${vector.why})`, async () => {
        const { hooks, mismatches } = scriptedHooks(vector);
        const run = runHarness({
          jsonFile: resolve(repoRoot, vector.model),
          entryId: vector.entryId,
          initialState: decodeState(vector.initialState),
          hooks,
        });

        if (vector.expect.error !== undefined) {
          await expect(run).rejects.toMatchObject(vector.expect.error);
          expect(mismatches).toEqual([]);
          return;
        }

        const result = await run;
        // Reported first: a hook that saw the wrong context explains every
        // other failure below it.
        expect(mismatches).toEqual([]);

        if (vector.expect.actions !== undefined) {
          const traces = actionTraces(result.trace);
          expect(traces.map((trace) => trace.actionId)).toEqual(
            vector.expect.actions.map((action) => action.actionId),
          );
          vector.expect.actions.forEach((expected, index) => {
            const trace = traces[index];
            if (expected.publishOutcomes !== undefined) {
              expect(trace?.publishOutcomes ?? []).toEqual(expected.publishOutcomes);
            }
          });
        }

        if (vector.expect.finalState !== undefined) {
          expect(encodeState(result.finalState)).toEqual(vector.expect.finalState);
        }
      });
    }
  });
}
