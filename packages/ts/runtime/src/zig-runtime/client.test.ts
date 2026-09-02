import { describe, expect, it } from "vitest";
import { ZigRuntimeClient, type ZigRuntimeExports } from "./client.js";

function testExports(): ZigRuntimeExports {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextAddress = 64;
  const encoder = new TextEncoder();
  return {
    memory,
    turnout_abi_version: () => 1,
    turnout_alloc(length) {
      const address = nextAddress;
      nextAddress += length;
      return address;
    },
    turnout_free: () => undefined,
    turnout_compute_execute(address, length) {
      const request = JSON.parse(
        new TextDecoder().decode(new Uint8Array(memory.buffer, address, length)),
      ) as unknown;
      expect(request).toEqual({ root: "answer" });
      const payload = encoder.encode(JSON.stringify({ value: 42 }));
      const responseAddress = nextAddress;
      nextAddress += 12 + payload.length;
      const bytes = new Uint8Array(memory.buffer, responseAddress, 12 + payload.length);
      const header = new DataView(bytes.buffer, bytes.byteOffset, 12);
      header.setUint32(0, 0x4e525554, true);
      header.setUint16(4, 1, true);
      header.setUint16(6, 0, true);
      header.setUint32(8, payload.length, true);
      bytes.set(payload, 12);
      return responseAddress;
    },
    turnout_value_operate: () => 0,
    turnout_runtime_create: () => 0,
    turnout_runtime_destroy: () => 0,
    turnout_runtime_step: () => 0,
    turnout_runtime_resume: () => 0,
    turnout_runtime_snapshot: () => 0,
  };
}

describe("ZigRuntimeClient compute", () => {
  it("uses the shared byte-buffer response protocol", () => {
    const client = new ZigRuntimeClient(testExports());
    expect(client.compute<{ value: number }>({ root: "answer" })).toEqual({
      status: "ok",
      payload: { value: 42 },
    });
  });
});
