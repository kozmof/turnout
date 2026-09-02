const ABI_VERSION = 1;
const RESPONSE_MAGIC = 0x4e525554;
const RESPONSE_HEADER_LENGTH = 12;

export type ZigStatus =
  | "ok"
  | "invalid_input"
  | "invalid_handle"
  | "runtime_error"
  | "out_of_memory"
  | "internal_error";

const STATUS_NAMES: readonly ZigStatus[] = [
  "ok",
  "invalid_input",
  "invalid_handle",
  "runtime_error",
  "out_of_memory",
  "internal_error",
];

export interface ZigRuntimeExports {
  readonly memory: WebAssembly.Memory;
  turnout_abi_version(): number;
  turnout_alloc(length: number): number;
  turnout_free(address: number, length: number): void;
  turnout_compute_execute(address: number, length: number): number;
  turnout_value_operate(address: number, length: number): number;
  turnout_runtime_create(
    modelAddress: number,
    modelLength: number,
    requestAddress: number,
    requestLength: number,
  ): number;
  turnout_runtime_destroy(handle: number): number;
  turnout_runtime_step(handle: number): number;
  turnout_runtime_resume(handle: number, address: number, length: number): number;
  turnout_runtime_snapshot(handle: number): number;
}

export interface ZigResponse<T = unknown> {
  status: ZigStatus;
  payload: T;
}

export class ZigAbiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZigAbiError";
  }
}

export class ZigRuntimeClient {
  readonly #exports: ZigRuntimeExports;
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(exports: ZigRuntimeExports) {
    if (exports.turnout_abi_version() !== ABI_VERSION) {
      throw new ZigAbiError("unsupported Zig runtime ABI version");
    }
    this.#exports = exports;
  }

  create(model: Uint8Array, request: unknown): ZigResponse<{ handle: number }> {
    return this.#withInputs([model, this.#encode(request)], ([modelInput, requestInput]) => {
      if (modelInput === undefined || requestInput === undefined)
        throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#exports.turnout_runtime_create(
          modelInput.address,
          modelInput.length,
          requestInput.address,
          requestInput.length,
        ),
      );
    });
  }

  memoryByteLength(): number {
    return this.#exports.memory.buffer.byteLength;
  }

  compute<T = unknown>(request: unknown): ZigResponse<T> {
    return this.#withInputs([this.#encode(request)], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(this.#exports.turnout_compute_execute(input.address, input.length));
    });
  }

  value<T = unknown>(request: unknown): ZigResponse<T> {
    return this.#withInputs([this.#encode(request)], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(this.#exports.turnout_value_operate(input.address, input.length));
    });
  }

  destroy(handle: number): ZigResponse<{ destroyed: number }> {
    return this.#readResponse(this.#exports.turnout_runtime_destroy(handle));
  }

  step<T = unknown>(handle: number): ZigResponse<T> {
    return this.#readResponse(this.#exports.turnout_runtime_step(handle));
  }

  snapshot<T = unknown>(handle: number): ZigResponse<{ state: T; done: boolean }> {
    return this.#readResponse(this.#exports.turnout_runtime_snapshot(handle));
  }

  resume(handle: number, result: unknown): ZigResponse<{ resumed: number }> {
    return this.#withInputs([this.#encode(result)], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#exports.turnout_runtime_resume(handle, input.address, input.length),
      );
    });
  }

  #encode(value: unknown): Uint8Array {
    return this.#encoder.encode(JSON.stringify(value));
  }

  #withInputs<T>(
    values: readonly Uint8Array[],
    operation: (inputs: readonly { address: number; length: number }[]) => T,
  ): T {
    const inputs: Array<{ address: number; length: number }> = [];
    try {
      for (const value of values) {
        if (value.length === 0) throw new ZigAbiError("empty ABI input");
        const address = this.#exports.turnout_alloc(value.length);
        if (address === 0) throw new ZigAbiError("Zig input allocation failed");
        inputs.push({ address, length: value.length });
        this.#memoryBytes(address, value.length).set(value);
      }
      return operation(inputs);
    } finally {
      for (const input of inputs) this.#exports.turnout_free(input.address, input.length);
    }
  }

  #readResponse<T>(address: number): ZigResponse<T> {
    if (address === 0) throw new ZigAbiError("Zig response allocation failed");
    let totalLength = RESPONSE_HEADER_LENGTH;
    try {
      const header = this.#memoryBytes(address, RESPONSE_HEADER_LENGTH);
      const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
      if (view.getUint32(0, true) !== RESPONSE_MAGIC) {
        throw new ZigAbiError("invalid Zig response magic");
      }
      if (view.getUint16(4, true) !== ABI_VERSION) {
        throw new ZigAbiError("invalid Zig response ABI version");
      }
      const status = STATUS_NAMES[view.getUint16(6, true)];
      if (status === undefined) throw new ZigAbiError("unknown Zig response status");
      const payloadLength = view.getUint32(8, true);
      totalLength += payloadLength;
      const payloadBytes = this.#memoryBytes(address + RESPONSE_HEADER_LENGTH, payloadLength);
      const payload = JSON.parse(this.#decoder.decode(payloadBytes)) as T;
      return { status, payload };
    } finally {
      this.#exports.turnout_free(address, totalLength);
    }
  }

  #memoryBytes(address: number, length: number): Uint8Array {
    const end = address + length;
    const memoryLength = this.#exports.memory.buffer.byteLength;
    if (
      !Number.isSafeInteger(address) ||
      !Number.isSafeInteger(length) ||
      address < 0 ||
      length < 0 ||
      end < address ||
      end > memoryLength
    ) {
      throw new ZigAbiError("Zig ABI memory range is out of bounds");
    }
    return new Uint8Array(this.#exports.memory.buffer, address, length);
  }
}

export async function instantiateZigRuntime(
  source: WebAssembly.Module | BufferSource,
): Promise<ZigRuntimeClient> {
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const instance = await WebAssembly.instantiate(module, {});
  return new ZigRuntimeClient(instance.exports as unknown as ZigRuntimeExports);
}
