// Node.js only — loads models from disk before delegating to the universal harness.
import type { FullHarnessResult, HookRegistry, LogEvent } from "../types/harness-types.js";
import type { AnyValue } from "runtime";
import { runConverter, loadJsonModel } from "./bridge.js";
import { runHarness } from "../harness/harness.js";
import { HarnessError } from "./errors.js";
import { containPath } from "./path-safety.js";

export type ServerHarnessOptions = {
  /** Path to a .turn file — the Go converter will be invoked to produce JSON. */
  turnFile?: string;
  /** Path to a pre-converted .json file — skips the converter invocation. */
  jsonFile?: string;
  /**
   * ID of the scene or route to execute.
   * If it matches a route.id, the route executor is used.
   * If it matches a scene.id, the scene executor is used directly.
   */
  entryId: string;
  /** Initial STATE values, keyed by dotted path ("namespace.field"). */
  initialState: Record<string, AnyValue>;
  /** Permit executing a model with no STATE schema. Defaults to false. */
  allowUncheckedState?: boolean;
  /** Optional hook implementations for from_hook prepare entries. */
  hooks?: HookRegistry;
  /** Maximum action steps allowed per scene execution. */
  maxSceneSteps?: number;
  /** Maximum scene transitions allowed during route execution. Defaults to 1,000. */
  maxRouteTransitions?: number;
  /** Optional cancellation signal forwarded to conversion, runner execution, and hooks. */
  signal?: AbortSignal;
  /** Called instead of console.warn when the model has no STATE schema. */
  onWarning?: (msg: string) => void;
  /** Optional structured execution log callback. */
  onLog?: (event: LogEvent) => void;
  /**
   * Optional base directory that turnFile/jsonFile must stay within after path
   * resolution. Set this for request-facing or multi-tenant server usage.
   */
  allowedBaseDir?: string;
  /**
   * When `true`, model parsing rejects unknown proto fields instead of ignoring
   * them. Leave `false` (the default) in production for forward compatibility;
   * enable in development/CI to catch Go-emitter ↔ TS-schema drift early.
   */
  strictParse?: boolean;
  /**
   * When `true`, a publish hook that throws aborts execution with a
   * `SceneRuntimeError("PublishHookFailed")` instead of being recorded as a
   * failed `publishOutcome` while execution continues. Defaults to `false`.
   */
  failOnPublishError?: boolean;
};

function resolveHarnessPath(filePath: string, allowedBaseDir: string | undefined): string {
  if (allowedBaseDir === undefined) return filePath;
  return containPath(filePath, allowedBaseDir);
}

/**
 * Server-only harness entry point.
 *
 * Loads a TurnModel from a `.turn` file (via Go converter) or a pre-built
 * `.json` file, then delegates to the universal `runHarness`.
 *
 * Do not use this in browser or edge environments — it requires Node.js
 * `child_process` and `fs`. Use `runHarness` directly when the model is
 * already available as a parsed object.
 */
export async function runServerHarness(options: ServerHarnessOptions): Promise<FullHarnessResult> {
  let model;
  if (options.turnFile && options.jsonFile) {
    throw new HarnessError(
      "AmbiguousEntryPoint",
      "runServerHarness: provide either turnFile or jsonFile, not both",
    );
  }

  const bridgeOptions = {
    ...(options.allowedBaseDir !== undefined && { safeBaseDir: options.allowedBaseDir }),
    ...(options.strictParse !== undefined && { strictParse: options.strictParse }),
    ...(options.signal !== undefined && { signal: options.signal }),
  };

  if (options.turnFile) {
    const turnPath = resolveHarnessPath(options.turnFile, options.allowedBaseDir);
    model = await runConverter(turnPath, bridgeOptions);
  } else if (options.jsonFile) {
    const jsonPath = resolveHarnessPath(options.jsonFile, options.allowedBaseDir);
    model = loadJsonModel(jsonPath, bridgeOptions);
  } else {
    throw new HarnessError(
      "MissingEntryPoint",
      "runServerHarness: either turnFile or jsonFile must be provided",
    );
  }

  return runHarness({
    model,
    entryId: options.entryId,
    initialState: options.initialState,
    ...(options.allowUncheckedState !== undefined && {
      allowUncheckedState: options.allowUncheckedState,
    }),
    ...(options.hooks !== undefined && { hooks: options.hooks }),
    ...(options.maxSceneSteps !== undefined && { maxSceneSteps: options.maxSceneSteps }),
    ...(options.maxRouteTransitions !== undefined && {
      maxRouteTransitions: options.maxRouteTransitions,
    }),
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.onWarning !== undefined && { onWarning: options.onWarning }),
    ...(options.onLog !== undefined && { onLog: options.onLog }),
    ...(options.failOnPublishError !== undefined && {
      failOnPublishError: options.failOnPublishError,
    }),
  });
}
