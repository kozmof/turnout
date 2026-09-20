import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { instantiateZigRuntime } from "runtime/zig-runtime";
import { createRunner, prepareModel } from "../src/runner.js";
import { defaultZigRuntimeClient } from "../src/zig-runtime/default-client.js";
import { ModelValidationError } from "../src/errors.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

function buildModel(actions: number): TurnModel {
  const list = [];
  for (let i = 0; i < actions; i += 1) {
    list.push({
      id: `act_${i}`,
      compute: {
        root: "result",
        prog: {
          name: "p",
          bindings: [
            { name: "a", type: "number", value: 2 },
            { name: "b", type: "number", value: 3 },
            {
              name: "result",
              type: "number",
              expr: { combine: { fn: "add", args: [{ ref: "a" }, { ref: "b" }] } },
            },
          ],
        },
      },
      merge: [{ binding: "result", toState: "score" }],
      next: i + 1 < actions ? [{ action: `act_${i + 1}` }] : [],
    });
  }
  return {
    version: 2,
    scenes: [{ id: "s", entryAction: "act_0", actions: list }],
    routes: [],
  } as unknown as TurnModel;
}

const options = { entryId: "s", initialState: {}, allowUncheckedState: true } as const;

describe("prepareModel", () => {
  it("runs identically to an unprepared model, repeatedly", async () => {
    const model = buildModel(3);
    const unprepared = await createRunner(model, options).run();

    const prepared = prepareModel(model);
    const first = await createRunner(prepared, options).run();
    const second = await createRunner(prepared, options).run();

    expect(first.finalState).toEqual(unprepared.finalState);
    // Each runner gets its own STATE; preparing shares the model, not the run.
    expect(second.finalState).toEqual(unprepared.finalState);
    prepared.release();
  });

  it("keeps runners created before release working", async () => {
    const prepared = prepareModel(buildModel(2));
    const runner = createRunner(prepared, options);
    prepared.release();

    const result = await runner.run();
    expect(result.finalState.score?.value).toBe(5);
  });

  it("release is idempotent", () => {
    const prepared = prepareModel(buildModel(1));
    expect(prepared.released).toBe(false);
    prepared.release();
    expect(prepared.released).toBe(true);
    prepared.release();
    expect(prepared.released).toBe(true);
  });

  it("rejects an invalid model when preparing rather than when running", () => {
    const broken = {
      version: 2,
      scenes: [{ id: "s", entryAction: "missing", actions: [{ id: "act" }] }],
      routes: [],
    } as unknown as TurnModel;
    expect(() => prepareModel(broken)).toThrow(ModelValidationError);
  });

  // The handle a prepared model holds means nothing to any other instance, so
  // which client it belongs to is part of what the caller is holding — and it
  // is the one thing `createRunner` compares before refusing with
  // ClientMismatch.
  it("names the client it was prepared on", () => {
    const prepared = prepareModel(buildModel(1));
    expect(prepared.client).toBe(defaultZigRuntimeClient);
    prepared.release();
  });

  it("refuses to run a prepared model on a different client", async () => {
    const prepared = prepareModel(buildModel(1));
    const other = await instantiateZigRuntime(
      await readFile(new URL("../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url)),
    );
    expect(() =>
      createRunner(prepared, { entryId: "main", initialState: {}, client: other }),
    ).toThrow(ModelValidationError);
    prepared.release();
  });
});
