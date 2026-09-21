import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { instantiateZigRuntime } from "turnout-runtime/zig-runtime";
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

// What `prepareModel` is for is not that it produces the same answer — the test
// at the top of this file already pins that — but that it does the setup once.
// README quotes the gap as about 850 µs of a 930 µs run against 13 µs from a
// prepared model, and that number is the whole reason the API exists.
//
// Nothing enforced it. A change that made `createRunner` re-encode and re-load a
// prepared model on every call would keep every test here green and quietly cost
// two orders of magnitude.
//
// This counts engine calls rather than microseconds. The work `prepareModel`
// hoists is one `prepareModel` call into the engine; the per-run call is
// `createWithModel` against the handle it returned. A prepared model used N
// times must show one of the first and N of the second, and must never reach
// `create`, which is the unprepared path that carries the model bytes with it.
// That is the same guarantee a timing assertion would make, without a threshold
// to tune or a loaded CI machine to flake on.
describe("prepareModel hoists the per-run work", () => {
  // A Proxy rather than a subclass or a prototype-delegating copy: the client
  // holds its exports in a private field, so every method has to run with the
  // real instance as its receiver or the field lookup throws.
  function countingClient() {
    const calls: Record<string, number> = { prepareModel: 0, createWithModel: 0, create: 0 };
    const real = defaultZigRuntimeClient;
    const client = new Proxy(real, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          // Only the three methods seeded into `calls` are counted; everything
          // else the runner reaches for passes straight through.
          const counted = typeof property === "string" ? calls[property] : undefined;
          if (counted !== undefined) calls[property as string] = counted + 1;
          return (value as (...rest: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    return { client, calls };
  }

  it("loads the model once across many runners", async () => {
    const { client, calls } = countingClient();
    const prepared = prepareModel(buildModel(3), { client });
    try {
      for (let run = 0; run < 5; run += 1) {
        await createRunner(prepared, options).run();
      }
    } finally {
      prepared.release();
    }

    expect(calls.prepareModel).toBe(1);
    expect(calls.createWithModel).toBe(5);
    expect(calls.create).toBe(0);
  });

  // The counterpart, so the assertion above is known to be measuring something:
  // an unprepared model really does pay the load on every single run.
  it("an unprepared model pays it on every run", async () => {
    const { client, calls } = countingClient();
    const model = buildModel(3);
    for (let run = 0; run < 5; run += 1) {
      await createRunner(model, { ...options, client }).run();
    }

    expect(calls.prepareModel).toBe(0);
    expect(calls.createWithModel).toBe(0);
    expect(calls.create).toBe(5);
  });
});
