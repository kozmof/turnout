import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  instantiateZigRuntime,
  ZigAbiError,
  ZigRuntimeClient,
  type ZigRuntimeExports,
} from "./client.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MockExports implements ZigRuntimeExports {
  readonly memory = new WebAssembly.Memory({ initial: 1 });
  readonly freed: Array<{ address: number; length: number }> = [];
  model = "";
  modelHandle = 0;
  request: unknown;
  resumed: unknown;
  nextAddress = 1024;

  turnout_abi_version(): number {
    return 1;
  }

  turnout_alloc(length: number): number {
    const address = this.nextAddress;
    this.nextAddress += length;
    return address;
  }

  turnout_free(address: number, length: number): void {
    this.freed.push({ address, length });
  }

  turnout_compute_execute(): number {
    return this.response(0, { value: 42 });
  }

  turnout_value_operate(): number {
    return this.response(0, { matches: true });
  }

  turnout_model_create(address: number, length: number): number {
    this.model = decoder.decode(this.bytes(address, length));
    return this.response(0, { handle: 7 });
  }

  turnout_model_destroy(handle: number): number {
    return this.response(0, { destroyed: handle });
  }

  turnout_runtime_create_with_model(
    modelHandle: number,
    requestAddress: number,
    requestLength: number,
  ): number {
    this.modelHandle = modelHandle;
    this.request = JSON.parse(decoder.decode(this.bytes(requestAddress, requestLength)));
    return this.response(0, { handle: 1, maxSceneSteps: 10, maxRouteTransitions: 5 });
  }

  turnout_runtime_create(
    modelAddress: number,
    modelLength: number,
    requestAddress: number,
    requestLength: number,
  ): number {
    this.model = decoder.decode(this.bytes(modelAddress, modelLength));
    this.request = JSON.parse(decoder.decode(this.bytes(requestAddress, requestLength)));
    return this.response(0, { handle: 7 });
  }

  turnout_runtime_destroy(handle: number): number {
    return this.response(0, { destroyed: handle });
  }

  turnout_runtime_step(): number {
    return this.response(0, { event: "complete" });
  }

  turnout_runtime_resume(_handle: number, address: number, length: number): number {
    this.resumed = JSON.parse(decoder.decode(this.bytes(address, length)));
    return this.response(0, { resumed: 3 });
  }

  turnout_runtime_snapshot(): number {
    return this.response(0, {
      state: { score: { symbol: "number", value: 7, tags: [] } },
      done: true,
    });
  }

  response(status: number, payload: unknown): number {
    const payloadBytes = encoder.encode(JSON.stringify(payload));
    const address = this.turnout_alloc(12 + payloadBytes.length);
    const bytes = this.bytes(address, 12 + payloadBytes.length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(0, 0x4e525554, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, status, true);
    view.setUint32(8, payloadBytes.length, true);
    bytes.set(payloadBytes, 12);
    return address;
  }

  bytes(address: number, length: number): Uint8Array {
    return new Uint8Array(this.memory.buffer, address, length);
  }
}

describe("ZigRuntimeClient", () => {
  it("copies create inputs and releases input and response buffers", () => {
    const exports = new MockExports();
    const client = new ZigRuntimeClient(exports);
    const response = client.create(encoder.encode('{"version":2}'), {
      sceneId: "main",
    });

    expect(response).toEqual({ status: "ok", payload: { handle: 7 } });
    expect(exports.model).toBe('{"version":2}');
    expect(exports.request).toEqual({ sceneId: "main" });
    expect(exports.freed).toHaveLength(3);
    expect(client.destroy(7)).toEqual({ status: "ok", payload: { destroyed: 7 } });
    expect(client.memoryByteLength()).toBe(65_536);
  });

  it("decodes step, snapshot, and resume responses", () => {
    const exports = new MockExports();
    const client = new ZigRuntimeClient(exports);

    expect(client.step(7)).toEqual({ status: "ok", payload: { event: "complete" } });
    expect(client.snapshot(7)).toEqual({
      status: "ok",
      payload: {
        state: { score: { symbol: "number", value: 7, tags: [] } },
        done: true,
      },
    });
    expect(client.compute<{ value: number }>({ root: "answer" })).toEqual({
      status: "ok",
      payload: { value: 42 },
    });
    expect(client.value<{ matches: boolean }>({ operation: "predicate" })).toEqual({
      status: "ok",
      payload: { matches: true },
    });
    expect(client.resume(7, { id: 3, kind: "publish", status: "ok" })).toEqual({
      status: "ok",
      payload: { resumed: 3 },
    });
    expect(exports.resumed).toEqual({ id: 3, kind: "publish", status: "ok" });
  });

  it("rejects ABI version mismatches", () => {
    const exports = new MockExports();
    exports.turnout_abi_version = () => 2;
    expect(() => new ZigRuntimeClient(exports)).toThrow(ZigAbiError);
  });

  it("rejects response ranges outside exported memory", () => {
    const exports = new MockExports();
    exports.turnout_runtime_step = () => exports.memory.buffer.byteLength - 4;
    const client = new ZigRuntimeClient(exports);
    expect(() => client.step(7)).toThrow("memory range is out of bounds");
  });

  it("rejects empty inputs and failed allocations while releasing prior inputs", () => {
    const emptyExports = new MockExports();
    const emptyClient = new ZigRuntimeClient(emptyExports);
    expect(() => emptyClient.create(new Uint8Array(), {})).toThrow("empty ABI input");

    const failedExports = new MockExports();
    let allocations = 0;
    failedExports.turnout_alloc = (length) => {
      allocations += 1;
      if (allocations === 2) return 0;
      const address = failedExports.nextAddress;
      failedExports.nextAddress += length;
      return address;
    };
    const failedClient = new ZigRuntimeClient(failedExports);
    expect(() => failedClient.create(encoder.encode("model"), {})).toThrow("allocation failed");
    expect(failedExports.freed).toEqual([{ address: 1024, length: 5 }]);
  });

  it.each([
    [
      "payload outside memory",
      (exports: MockExports) => {
        const address = exports.response(0, {});
        new DataView(exports.memory.buffer).setUint32(
          address + 8,
          exports.memory.buffer.byteLength,
          true,
        );
        return address;
      },
      "memory range is out of bounds",
    ],
    ["zero address", () => 0, "response allocation failed"],
    [
      "bad magic",
      (exports: MockExports) => {
        const address = exports.response(0, {});
        new DataView(exports.memory.buffer).setUint32(address, 0, true);
        return address;
      },
      "invalid Zig response magic",
    ],
    [
      "bad ABI version",
      (exports: MockExports) => {
        const address = exports.response(0, {});
        new DataView(exports.memory.buffer).setUint16(address + 4, 2, true);
        return address;
      },
      "invalid Zig response ABI version",
    ],
    [
      "unknown status",
      (exports: MockExports) => exports.response(99, {}),
      "unknown Zig response status",
    ],
    [
      "invalid JSON",
      (exports: MockExports) => {
        const address = exports.response(0, {});
        const view = new DataView(exports.memory.buffer);
        view.setUint32(address + 8, 1, true);
        new Uint8Array(exports.memory.buffer)[address + 12] = 0x7b;
        return address;
      },
      "JSON",
    ],
  ] as const)("rejects %s responses", (_name, response, message) => {
    const exports = new MockExports();
    exports.turnout_runtime_step = () => response(exports);
    const client = new ZigRuntimeClient(exports);
    expect(() => client.step(7)).toThrow(message);
  });

  it("instantiates byte buffers and compiled modules", async () => {
    const bytes = await readFile(
      new URL("../../../../zig/zig-out/bin/turnout-runtime.wasm", import.meta.url),
    );
    const fromBytes = await instantiateZigRuntime(bytes);
    expect(fromBytes.memoryByteLength()).toBeGreaterThan(0);
    const fromModule = await instantiateZigRuntime(await WebAssembly.compile(bytes));
    expect(fromModule.memoryByteLength()).toBeGreaterThan(0);
  });

  it.each([-1, 1.5, Number.NaN])("rejects invalid response address %s", (address) => {
    const exports = new MockExports();
    exports.turnout_runtime_step = () => address;
    const client = new ZigRuntimeClient(exports);
    expect(() => client.step(7)).toThrow("memory range is out of bounds");
  });
});

describe("prepared models", () => {
  it("prepares a model once and creates runtimes against its handle", () => {
    const exports = new MockExports();
    const client = new ZigRuntimeClient(exports as unknown as ZigRuntimeExports);

    const prepared = client.prepareModel(new TextEncoder().encode('{"version":2}'));
    expect(prepared.status).toBe("ok");
    expect(prepared.payload.handle).toBe(7);
    expect(exports.model).toBe('{"version":2}');

    // Creating with a handle sends the request only; the model does not travel
    // across the boundary again.
    const created = client.createWithModel(7, { sceneId: "main" });
    expect(created.status).toBe("ok");
    expect(exports.modelHandle).toBe(7);
    expect(exports.request).toEqual({ sceneId: "main" });

    expect(client.destroyModel(7).payload).toEqual({ destroyed: 7 });
  });
});
