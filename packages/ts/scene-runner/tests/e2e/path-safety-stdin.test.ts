/**
 * E2E: safeBaseDir path hardening + converter stdin path.
 *
 * Exercises the real Go converter (not mocks) to confirm that, with
 * `safeBaseDir` set, the bridge reads the .turn itself (TOCTOU-hardened) and
 * streams it to the converter over stdin, producing a model identical to the
 * unhardened path — and that symlink escapes out of the base are rejected.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runConverter, loadTurnFile } from "../../src/server/bridge.js";
import { containPath, readContainedFile } from "../../src/server/path-safety.js";
import { isHarnessError } from "../../src/server/errors.js";

const converterDir = resolve(__dirname, "../../../../go/converter");
const tmpRoot = mkdtempSync(join(tmpdir(), "turnout-path-safety-e2e-"));
const turnoutBin = join(tmpRoot, "turnout");
const goBin = process.env.GOROOT
  ? join(process.env.GOROOT, "bin", "go")
  : existsSync("/usr/local/go/bin/go")
    ? "/usr/local/go/bin/go"
    : "go";

const TURN_SRC = `state { ns { v:number = 0 } }
scene "s" {
  entry_actions = ["a"]
  action "a" { compute { root = "r" prog "p" { r:bool = true } } }
}`;

let baseDir: string;
let turnPath: string;

beforeAll(() => {
  execFileSync(goBin, ["build", "-buildvcs=false", "-o", turnoutBin, "./cmd/turnout"], {
    cwd: converterDir,
    stdio: "pipe",
    env: {
      ...process.env,
      GOCACHE:
        process.env.GOCACHE ??
        (existsSync("/workspace")
          ? resolve(converterDir, "../../../.go-cache")
          : join(homedir(), ".cache", "go-build")),
    },
  });

  baseDir = mkdtempSync(join(tmpRoot, "base-"));
  turnPath = join(baseDir, "story.turn");
  writeFileSync(turnPath, TURN_SRC, "utf8");
});

describe("safeBaseDir converter (stdin hardening)", () => {
  it("converts a contained .turn via stdin, matching the unhardened path", async () => {
    const hardened = await runConverter(turnPath, { binPath: turnoutBin, safeBaseDir: baseDir });
    const plain = await runConverter(turnPath, { binPath: turnoutBin });

    expect(hardened.scenes[0]!.id).toBe("s");
    expect(hardened).toEqual(plain);
  });

  it("rejects a symlink inside the base that points outside it", async () => {
    const secret = join(tmpRoot, "secret.turn");
    writeFileSync(secret, TURN_SRC, "utf8");
    const link = join(baseDir, "escape.turn");
    symlinkSync(secret, link);

    await expect(
      runConverter(link, { binPath: turnoutBin, safeBaseDir: baseDir }),
    ).rejects.toMatchObject({ code: "PathOutsideBase" });
  });
});

describe("readContainedFile (fd hardening)", () => {
  it("reads a contained file's content", () => {
    expect(readContainedFile(turnPath, baseDir)).toBe(TURN_SRC);
  });

  it("rejects a relative path escaping the base", () => {
    expect(() => readContainedFile("../../etc/hosts", baseDir)).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });

  it("rejects a symlink that resolves outside the base", () => {
    const outside = join(tmpRoot, "outside.txt");
    writeFileSync(outside, "secret", "utf8");
    const link = join(baseDir, "leak.txt");
    symlinkSync(outside, link);

    let caught: unknown;
    try {
      readContainedFile(link, baseDir);
    } catch (e) {
      caught = e;
    }
    expect(isHarnessError(caught)).toBe(true);
  });
});

describe("loadTurnFile with safeBaseDir", () => {
  it("loads a contained file", () => {
    expect(loadTurnFile(turnPath, { safeBaseDir: baseDir })).toBe(TURN_SRC);
  });

  it("rejects an absolute path outside the base", () => {
    expect(() => loadTurnFile("/etc/hosts", { safeBaseDir: baseDir })).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });
});

describe("containPath", () => {
  it("returns the contained absolute path", () => {
    expect(containPath("story.turn", baseDir)).toBe(turnPath);
  });

  it("rejects sibling directories sharing only a name prefix", () => {
    expect(() => containPath(`${baseDir}-other/x.turn`, baseDir)).toThrow(
      expect.objectContaining({ code: "PathOutsideBase" }),
    );
  });
});
