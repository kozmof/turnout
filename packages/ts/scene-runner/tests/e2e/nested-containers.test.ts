/**
 * E2E: recursive array/Record state types.
 *
 * Pipeline: .tu source -> Go converter -> proto model -> scene runner -> STATE.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildArray,
  buildArrayNumber,
  buildNumber,
  buildRecord,
  isArray,
  isPureNumber,
  isRecord,
} from "runtime";
import { runServerHarness as runHarness } from "../../src/server/index.js";

const converterDir = resolve(__dirname, "../../../../go/converter");
const tmpRoot = mkdtempSync(join(tmpdir(), "turnout-nested-container-e2e-"));
const turnoutBin = join(tmpRoot, "turnout");
const turnFile = join(tmpRoot, "nested-containers.tu");
const goBin = process.env.GOROOT
  ? join(process.env.GOROOT, "bin", "go")
  : existsSync("/usr/local/go/bin/go")
    ? "/usr/local/go/bin/go"
    : "go";

const source = `state {
  input {
    rows:arr<Record<str, number>> = []
    groups:Record<str, arr<number>> = {}
    replacement:arr<number> = []
    deep:Record<str, arr<Record<str, arr<number>>>> = {}
  }
  output {
    first:Record<str, number> = {}
    groups:Record<str, arr<number>> = {}
    deep_value:number = 0
  }
}

scene "nested_both" {
  entry_action = run
  action "run" {
    compute "nested" {
      rows:arr<Record<str, number>> <~ @input.rows
      groups:Record<str, arr<number>> <~ @input.groups
      replacement:arr<number> <~ @input.replacement

      first:Record<str, number> = arr_get(rows, 0)
      updated_first:Record<str, number> = (record_set(first, "count", 99)) ~> @output.first
      updated_groups:Record<str, arr<number>> = (record_set(groups, "scores", replacement)) ~> @output.groups
      count:number = record_get(updated_first, "count")
      scores:arr<number> = record_get(updated_groups, "scores")
      first_score:number = arr_get(scores, 0)
      score_ok:bool = first_score == 8
      ok:bool := count == 99 & score_ok
    }
  }
}

scene "nested_deep" {
  entry_action = run
  action "run" {
    compute "deep" {
      deep:Record<str, arr<Record<str, arr<number>>>> <~ @input.deep
      rows:arr<Record<str, arr<number>>> = record_get(deep, "rows")
      first:Record<str, arr<number>> = arr_get(rows, 0)
      values:arr<number> = record_get(first, "values")
      value:number := (arr_get(values, 0)) ~> @output.deep_value
    }
  }
}
`;

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
  process.env.TURNOUT_BIN = turnoutBin;
  writeFileSync(turnFile, source, "utf8");
});

describe("recursive array/Record types", () => {
  it("executes array-in-Record and Record-in-array get/set flows", async () => {
    const { finalState } = await runHarness({
      turnFile,
      entryId: "nested_both",
      initialState: {
        "input.rows": buildArray([buildRecord({ count: buildNumber(7) })]),
        "input.groups": buildRecord({ scores: buildArrayNumber([buildNumber(1), buildNumber(2)]) }),
        "input.replacement": buildArrayNumber([buildNumber(8), buildNumber(9)]),
      },
    });

    const first = finalState["output.first"];
    expect(
      first && isRecord(first) && isPureNumber(first.value.count!) && first.value.count.value,
    ).toBe(99);

    const groups = finalState["output.groups"];
    expect(groups && isRecord(groups)).toBe(true);
    if (!groups || !isRecord(groups)) throw new Error("expected output.groups Record");
    const scores = groups.value.scores;
    expect(scores && isArray(scores)).toBe(true);
    if (!scores || !isArray(scores)) throw new Error("expected scores array");
    expect(scores.value.map((item) => item.value)).toEqual([8, 9]);
  });

  it("executes deeper recursive container composition", async () => {
    const { finalState } = await runHarness({
      turnFile,
      entryId: "nested_deep",
      initialState: {
        "input.deep": buildRecord({
          rows: buildArray([buildRecord({ values: buildArrayNumber([buildNumber(42)]) })]),
        }),
      },
    });

    const value = finalState["output.deep_value"];
    expect(value && isPureNumber(value) && value.value).toBe(42);
  });
});
