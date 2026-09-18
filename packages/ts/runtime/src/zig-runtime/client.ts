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
  turnout_model_create(address: number, length: number): number;
  turnout_model_merge(address: number, length: number): number;
  turnout_model_destroy(handle: number): number;
  turnout_runtime_create_with_model(
    modelHandle: number,
    requestAddress: number,
    requestLength: number,
  ): number;
  turnout_runtime_destroy(handle: number): number;
  turnout_runtime_step(handle: number): number;
  turnout_runtime_resume(handle: number, address: number, length: number): number;
  turnout_runtime_snapshot(handle: number): number;
}

export interface PreparedModel {
  handle: number;
}

/** Which input a merged scene, route, type or STATE field was taken from. */
export interface MergeOrigin {
  kind: "scene" | "route" | "typeDecl" | "field";
  /** Scene, route or type name. For a field, "<namespace>.<field>". */
  id: string;
  /** Index of the input that declared it. */
  input: number;
}

export interface MergedModel {
  model: unknown;
  provenance: MergeOrigin[];
}

export interface CreatedRuntime {
  handle: number;
  /** Limits actually in force, from the request or the runtime defaults. */
  maxSceneSteps: number;
  maxRouteTransitions: number;
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

/**
 * Thrown when the WASM instance trapped, and for every call made afterwards.
 *
 * A trap unwinds the module without running the epilogues that restore its
 * stack pointer and finish whatever the allocator was in the middle of, so an
 * instance that has trapped once cannot be relied on again — later calls may
 * trap on entry, or return nonsense. There is no way to reset it from outside.
 *
 * Recovery is to build a new client with {@link instantiateZigRuntime}. Any
 * runtime or model handle held against the old instance is gone with it.
 */
export class ZigTrapError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ZigTrapError";
  }
}

/**
 * Whether an error thrown out of a WASM call means the instance trapped.
 *
 * `WebAssembly.RuntimeError` covers an out-of-bounds access or an explicit
 * trap. A stack overflow inside the module surfaces as a plain `RangeError`
 * instead, because it is the engine's own call-depth limit that fires.
 */
function isTrap(error: unknown): boolean {
  return error instanceof WebAssembly.RuntimeError || error instanceof RangeError;
}

export class ZigRuntimeClient {
  readonly #exports: ZigRuntimeExports;
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #trapped: unknown;

  constructor(exports: ZigRuntimeExports) {
    if (exports.turnout_abi_version() !== ABI_VERSION) {
      throw new ZigAbiError("unsupported Zig runtime ABI version");
    }
    this.#exports = exports;
  }

  /**
   * Whether this client can still be used. False once the instance has
   * trapped, from which there is no recovery but a new instance.
   */
  get usable(): boolean {
    return this.#trapped === undefined;
  }

  /**
   * Runs one call into the module, refusing to enter an instance that has
   * already trapped and recording it if this call is the one that traps.
   *
   * The flag has to be set here rather than in a caller's `catch`, because the
   * `finally` blocks that release inputs and responses run while the throw is
   * still unwinding — and they must not call back into a trapped instance.
   */
  #invoke<T>(operation: () => T): T {
    if (this.#trapped !== undefined) {
      throw new ZigTrapError("Zig runtime instance trapped earlier and cannot be reused", {
        cause: this.#trapped,
      });
    }
    try {
      return operation();
    } catch (error) {
      if (!isTrap(error)) throw error;
      this.#trapped = error;
      throw new ZigTrapError("Zig runtime trapped; discard this instance and build a new one", {
        cause: error,
      });
    }
  }

  create(model: Uint8Array, request: unknown): ZigResponse<CreatedRuntime> {
    return this.#withInputs([model, this.#encode(request)], ([modelInput, requestInput]) => {
      if (modelInput === undefined || requestInput === undefined)
        throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() =>
          this.#exports.turnout_runtime_create(
            modelInput.address,
            modelInput.length,
            requestInput.address,
            requestInput.length,
          ),
        ),
      );
    });
  }

  /**
   * Parse, validate, index, and lower a model once, under a handle.
   *
   * That work is most of what creating a runtime costs and produces the same
   * result every time, so a host running one model repeatedly should prepare it
   * once and create runtimes with {@link createWithModel}.
   */
  prepareModel(model: Uint8Array): ZigResponse<PreparedModel> {
    return this.#withInputs([model], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() => this.#exports.turnout_model_create(input.address, input.length)),
      );
    });
  }

  /**
   * Combine separately compiled models into one.
   *
   * `models` are runtime-projection objects and `labels` names them positionally
   * in conflict messages. A collision is never an override: the response status
   * is `invalid_input` and its payload carries every conflict found, not just
   * the first.
   *
   * The merged model comes back with `provenance`, recording the input each
   * item was taken from, so a caller holding richer objects than the runtime
   * projection can rebuild its own result without repeating the rules.
   */
  mergeModels(models: readonly unknown[], labels: readonly string[]): ZigResponse<MergedModel> {
    return this.#withInputs([this.#encode({ models, labels })], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() => this.#exports.turnout_model_merge(input.address, input.length)),
      );
    });
  }

  /**
   * Release a prepared model. Runtimes still running against it keep it alive
   * until they are destroyed.
   */
  destroyModel(handle: number): ZigResponse<{ destroyed: number }> {
    return this.#readResponse(this.#invoke(() => this.#exports.turnout_model_destroy(handle)));
  }

  /** Create a runtime against a model already prepared by {@link prepareModel}. */
  createWithModel(modelHandle: number, request: unknown): ZigResponse<CreatedRuntime> {
    return this.#withInputs([this.#encode(request)], ([requestInput]) => {
      if (requestInput === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() =>
          this.#exports.turnout_runtime_create_with_model(
            modelHandle,
            requestInput.address,
            requestInput.length,
          ),
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
      return this.#readResponse(
        this.#invoke(() => this.#exports.turnout_compute_execute(input.address, input.length)),
      );
    });
  }

  value<T = unknown>(request: unknown): ZigResponse<T> {
    return this.#withInputs([this.#encode(request)], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() => this.#exports.turnout_value_operate(input.address, input.length)),
      );
    });
  }

  destroy(handle: number): ZigResponse<{ destroyed: number }> {
    return this.#readResponse(this.#invoke(() => this.#exports.turnout_runtime_destroy(handle)));
  }

  step<T = unknown>(handle: number): ZigResponse<T> {
    return this.#readResponse(this.#invoke(() => this.#exports.turnout_runtime_step(handle)));
  }

  snapshot<T = unknown>(handle: number): ZigResponse<{ state: T; done: boolean }> {
    return this.#readResponse(this.#invoke(() => this.#exports.turnout_runtime_snapshot(handle)));
  }

  resume(handle: number, result: unknown): ZigResponse<{ resumed: number }> {
    return this.#withInputs([this.#encode(result)], ([input]) => {
      if (input === undefined) throw new ZigAbiError("missing ABI input");
      return this.#readResponse(
        this.#invoke(() =>
          this.#exports.turnout_runtime_resume(handle, input.address, input.length),
        ),
      );
    });
  }

  /**
   * Releases a block handed out by the module.
   *
   * Called from `finally`, so it must neither throw over an error already
   * unwinding nor call into an instance whose allocator state is unknown. A
   * trapped instance is about to be discarded whole, so skipping the free
   * leaks nothing that outlives it.
   */
  #release(address: number, length: number): void {
    if (this.#trapped !== undefined) return;
    try {
      this.#exports.turnout_free(address, length);
    } catch (error) {
      if (isTrap(error)) this.#trapped = error;
    }
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
        const address = this.#invoke(() => this.#exports.turnout_alloc(value.length));
        if (address === 0) throw new ZigAbiError("Zig input allocation failed");
        inputs.push({ address, length: value.length });
        this.#memoryBytes(address, value.length).set(value);
      }
      return operation(inputs);
    } finally {
      for (const input of inputs) this.#release(input.address, input.length);
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
      this.#release(address, totalLength);
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
