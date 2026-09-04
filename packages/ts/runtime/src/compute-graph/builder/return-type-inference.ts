import type { BaseTypeSymbol } from "../../state-control/value.js";
import { inferGraphFunctionTypes } from "../../zig-runtime/preset-metadata.js";
import type { ContextSpec, FunctionBuilder } from "./types.js";

/**
 * Builds every function's return type by asking Zig, which owns the inference
 * rules (combine return types, pipe last-step propagation, and the requirement
 * that a cond's branches agree before it has a type at all).
 *
 * The builder needs these types before the real tables exist, so it assembles a
 * skeleton context keyed by spec key. Zig's "functions" query reads only the
 * structure below — funcTable `kind`/`defId`, cond branch ids, pipe step def
 * ids, and combine definition names — and never reads `transformFn`, so a
 * skeleton with no transforms yields the same answer the finished context would.
 */
export function inferReturnTypesByFuncKey(
  spec: ContextSpec,
  isFunctionBuilder: (value: unknown) => value is FunctionBuilder,
): Map<string, BaseTypeSymbol> {
  const skeleton = buildSkeletonContext(spec, isFunctionBuilder);
  const types = inferGraphFunctionTypes(skeleton.funcKeys, skeleton.context);

  const returnTypeByFuncKey = new Map<string, BaseTypeSymbol>();
  skeleton.funcKeys.forEach((key, index) => {
    const inferred = types[index];
    if (inferred !== undefined && inferred !== null) returnTypeByFuncKey.set(key, inferred);
  });
  return returnTypeByFuncKey;
}

type SkeletonContext = {
  readonly funcKeys: string[];
  readonly context: {
    valueTable: Record<string, never>;
    funcTable: Record<string, { kind: string; defId: string }>;
    combineFuncDefTable: Record<string, { name: string }>;
    pipeFuncDefTable: Record<string, { sequence: { defId: string }[] }>;
    condFuncDefTable: Record<string, { trueBranchId: string; falseBranchId: string }>;
  };
};

function buildSkeletonContext(
  spec: ContextSpec,
  isFunctionBuilder: (value: unknown) => value is FunctionBuilder,
): SkeletonContext {
  const context: SkeletonContext["context"] = {
    valueTable: {},
    funcTable: {},
    combineFuncDefTable: {},
    pipeFuncDefTable: {},
    condFuncDefTable: {},
  };
  const funcKeys: string[] = [];

  // Definition ids are synthetic and local to the skeleton. A counter keeps them
  // collision-free regardless of what characters a spec key contains.
  let nextDefId = 0;
  const mintDefId = (): string => `d${String(nextDefId++)}`;

  for (const [key, value] of Object.entries(spec)) {
    if (!isFunctionBuilder(value)) continue;
    funcKeys.push(key);
    const defId = mintDefId();
    context.funcTable[key] = { kind: value.__type, defId };

    switch (value.__type) {
      case "combine":
        context.combineFuncDefTable[defId] = { name: value.name };
        break;
      case "pipe":
        context.pipeFuncDefTable[defId] = {
          sequence: value.steps.map((step) => {
            const stepDefId = mintDefId();
            // Non-combine steps are rejected later by processPipeFunc. Leaving the
            // definition unregistered simply makes the pipe's type uninferable here.
            if (step.__type === "combine") {
              context.combineFuncDefTable[stepDefId] = { name: step.name };
            }
            return { defId: stepDefId };
          }),
        };
        break;
      case "cond":
        context.condFuncDefTable[defId] = {
          trueBranchId: value.then,
          falseBranchId: value.else,
        };
        break;
    }
  }

  return { funcKeys, context };
}
