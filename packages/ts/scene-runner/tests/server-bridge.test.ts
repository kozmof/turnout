import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  accessSync: vi.fn(),
  constants: { X_OK: 1 },
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import {
  loadTurnFile,
  loadJsonModel,
  runConverter,
  convertToHCL,
} from "../src/server/bridge.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

const mockReadFile = vi.mocked(readFileSync) as unknown as ReturnType<typeof vi.fn>;
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;

const MOCK_BIN = "/mock/turnout";

const minimalModel = {
  scenes: [{ id: "scene_a", entryActions: [], actions: [] }],
} as unknown as TurnModel;

type ExecFileCb = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

/** Sets up mockExecFile to call its callback with the given JSON output. */
function setupConvert(modelJson = JSON.stringify(minimalModel)): void {
  mockExecFile.mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
      cb(null, Buffer.from(modelJson), Buffer.from(""));
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// loadTurnFile
// ─────────────────────────────────────────────────────────────────────────────

describe("loadTurnFile", () => {
  it("reads and returns file content as a string", () => {
    mockReadFile.mockReturnValue("turn file content");
    const result = loadTurnFile("test.turn");
    expect(result).toBe("turn file content");
    expect(mockReadFile).toHaveBeenCalledWith("test.turn", "utf8");
  });

  it("wraps read errors with a descriptive message", () => {
    mockReadFile.mockImplementation(() => {
      throw new Error("ENOENT: no such file");
    });
    expect(() => loadTurnFile("missing.turn")).toThrow(
      'Cannot read turn file "missing.turn": ENOENT: no such file',
    );
  });

  it("handles non-Error exceptions", () => {
    mockReadFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "raw string error";
    });
    expect(() => loadTurnFile("bad.turn")).toThrow("Cannot read turn file");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadJsonModel
// ─────────────────────────────────────────────────────────────────────────────

describe("loadJsonModel", () => {
  it("parses and returns a valid JSON model", () => {
    mockReadFile.mockReturnValue(JSON.stringify(minimalModel));
    const result = loadJsonModel("model.json");
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].id).toBe("scene_a");
  });

  it("wraps file-read errors with a descriptive message", () => {
    mockReadFile.mockImplementation(() => {
      throw new Error("Permission denied");
    });
    expect(() => loadJsonModel("secret.json")).toThrow(
      'Cannot read JSON model "secret.json": Permission denied',
    );
  });

  it("wraps non-Error file-read failures", () => {
    mockReadFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "disk error";
    });
    expect(() => loadJsonModel("secret.json")).toThrow('Cannot read JSON model "secret.json"');
  });

  it("wraps invalid JSON with a descriptive message", () => {
    mockReadFile.mockReturnValue("not valid json {{{");
    expect(() => loadJsonModel("bad.json")).toThrow('Invalid JSON from "bad.json"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runConverter
// ─────────────────────────────────────────────────────────────────────────────

describe("runConverter", () => {
  it("invokes the turnout binary and returns the parsed model", async () => {
    setupConvert();
    const result = await runConverter("my.turn", { binPath: MOCK_BIN });
    expect(result.scenes[0].id).toBe("scene_a");
    expect(mockExecFile).toHaveBeenCalled();
  });

  it("passes timeout and maxBuffer options to the execFile call", async () => {
    setupConvert();
    await runConverter("my.turn", { binPath: MOCK_BIN });
    const opts = (mockExecFile.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(opts).toMatchObject({ timeout: expect.any(Number), maxBuffer: expect.any(Number) });
  });

  it("wraps converter failures with a descriptive message", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(new Error("exit code 1"), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(runConverter("my.turn", { binPath: MOCK_BIN })).rejects.toThrow(
      'turnout converter failed for "my.turn"',
    );
  });

  it("wraps non-Error converter failures", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        cb(Object.assign(new Error("raw string failure"), {}), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(runConverter("my.turn", { binPath: MOCK_BIN })).rejects.toThrow(
      'turnout converter failed for "my.turn"',
    );
  });

  it("throws BufferOverflow BridgeError when stdout exceeds maxBuffer", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(new RangeError("stdout maxBuffer length exceeded"), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(runConverter("big.turn", { binPath: MOCK_BIN })).rejects.toMatchObject({
      code: "BufferOverflow",
    });
  });

  it("uses binPath directly without a PATH probe when binPath is provided", async () => {
    setupConvert();
    await runConverter("my.turn", { binPath: MOCK_BIN });
    // Only one execFile call: the conversion itself (no --help probe).
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const calledBin = (mockExecFile.mock.calls[0] as unknown[])[0] as string;
    expect(calledBin).toBe(MOCK_BIN);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convertToHCL
// ─────────────────────────────────────────────────────────────────────────────

describe("convertToHCL", () => {
  it("returns the HCL output as a string", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(null, Buffer.from("hcl content here"), Buffer.from(""));
      },
    );
    const result = await convertToHCL("my.turn", { binPath: MOCK_BIN });
    expect(result).toBe("hcl content here");
  });

  it("wraps converter failures with a descriptive message", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(new Error("converter error"), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(convertToHCL("my.turn", { binPath: MOCK_BIN })).rejects.toThrow(
      'turnout converter failed for "my.turn"',
    );
  });

  it("wraps non-Error failures", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(Object.assign(new Error("42"), {}), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(convertToHCL("my.turn", { binPath: MOCK_BIN })).rejects.toThrow(
      'turnout converter failed for "my.turn"',
    );
  });

  it("throws BufferOverflow BridgeError when stdout exceeds maxBuffer", async () => {
    mockExecFile.mockImplementation(
      (_bin: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        cb(new RangeError("stdout maxBuffer length exceeded"), Buffer.from(""), Buffer.from(""));
      },
    );
    await expect(convertToHCL("big.turn", { binPath: MOCK_BIN })).rejects.toMatchObject({
      code: "BufferOverflow",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BridgeOptions.safeBaseDir (path enforcement)
// ─────────────────────────────────────────────────────────────────────────────

describe("BridgeOptions.safeBaseDir", () => {
  it("loadTurnFile allows paths inside safeBaseDir", () => {
    mockReadFile.mockReturnValue("content");
    expect(() => loadTurnFile("/base/sub/file.turn", { safeBaseDir: "/base" })).not.toThrow();
  });

  it("loadTurnFile rejects paths outside safeBaseDir", () => {
    expect(() => loadTurnFile("/etc/passwd", { safeBaseDir: "/base" })).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });

  it("loadJsonModel rejects paths outside safeBaseDir", () => {
    expect(() => loadJsonModel("../../secret.json", { safeBaseDir: "/base" })).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });

  it("runConverter rejects paths outside safeBaseDir", async () => {
    await expect(
      runConverter("/etc/passwd", { binPath: MOCK_BIN, safeBaseDir: "/base" }),
    ).rejects.toMatchObject({ code: "PathOutsideBase" });
  });

  it("convertToHCL rejects paths outside safeBaseDir", async () => {
    await expect(
      convertToHCL("../../escape.turn", { binPath: MOCK_BIN, safeBaseDir: "/base" }),
    ).rejects.toMatchObject({ code: "PathOutsideBase" });
  });
});
