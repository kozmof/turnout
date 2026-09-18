import { toJson } from "@bufbuild/protobuf";
import type { TurnModel } from "./types/turnout-model_pb.js";
import { TurnModelSchema } from "./types/turnout-model_pb.js";

/**
 * The model as the runtime reads it.
 *
 * A caller-facing model carries authoring metadata the runtime has no use for
 * and, in the case of compiler-only fields, actively rejects. Projecting it
 * here rather than at each call site keeps one answer to what the runtime sees:
 * the runner encodes models this way, `mergeModels` encodes its inputs this way,
 * and an `extend` hook's returned model is encoded this way before it crosses
 * the boundary.
 */
export function encodeZigRuntimeModel(model: TurnModel): Uint8Array {
  // Loading is the one place the version is asserted rather than read: the
  // runtime only runs version 2, so a model reaching it is stamped as such.
  // Merging must not do that — an input compiled at another version is a
  // conflict, and overriding it here would hide exactly that.
  return new TextEncoder().encode(JSON.stringify({ ...zigRuntimeModelJson(model), version: 2 }));
}

/** The same projection as an object, for callers that nest it in a request. */
export function zigRuntimeModelJson(model: TurnModel): Record<string, unknown> {
  let protobufJson: unknown;
  try {
    protobufJson = toJson(TurnModelSchema, model);
  } catch {
    protobufJson = model;
  }
  return runtimeProjection(protobufJson);
}

/** @internal Exported for contract tests. */
export function runtimeProjection(input: unknown): Record<string, unknown> {
  const root = structuredClone(input) as Record<string, unknown>;
  delete root.annotations;
  for (const declaration of arrayRecords(root.typeDecls)) delete declaration.sourcePos;
  for (const route of arrayRecords(root.routes)) route.match ??= [];
  for (const scene of arrayRecords(root.scenes)) {
    const view = objectRecord(scene.view);
    if (view !== undefined) {
      delete view.nodes;
      delete view.edges;
      delete view.sourcePos;
    }
    for (const action of arrayRecords(scene.actions)) {
      stripComputeMetadata(action.compute);
      for (const rule of arrayRecords(action.next)) stripComputeMetadata(rule.compute);
    }
  }
  return root;
}

function stripComputeMetadata(input: unknown): void {
  const compute = objectRecord(input);
  const prog = objectRecord(compute?.prog);
  if (prog === undefined) return;
  delete prog.sigils;
  for (const binding of arrayRecords(prog.bindings)) {
    delete binding.extExpr;
    delete binding.sourcePos;
    delete binding.declaredType;
  }
}

function arrayRecords(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input)
    ? input.filter((entry): entry is Record<string, unknown> => objectRecord(entry) !== undefined)
    : [];
}

function objectRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
