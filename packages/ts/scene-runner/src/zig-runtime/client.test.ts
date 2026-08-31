import { describe, expect, it } from "vitest";
import { ZigAbiError, ZigRuntimeClient, type ZigRuntimeExports } from "./client.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class MockExports implements ZigRuntimeExports {
  readonly memory = new WebAssembly.Memory({ initial: 1 });
  readonly freed: Array<{ address: number; length: number }> = [];
  model = "";
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
});
