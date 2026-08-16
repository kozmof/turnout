/**
 * E2E: transition match blocks (`next on (...) match { }`)
 *
 * Pipeline: shipping-dispatch-match.tu → Go converter → runHarness → trace and
 * STATE assertions.
 *
 * The form is surface sugar that expands, in the parser, to one next rule per
 * arm. Unit tests in the converter pin the expansion and prove the emitted
 * model is identical to the hand-written rules. What they cannot show is that
 * those rules *behave* like a match: that the runtime evaluates them in arm
 * order, that the first matching arm wins, that a `_` column really is
 * unconstrained, and that the `_` arm catches everything else.
 *
 * That is what this file covers — the runtime has no idea the form exists, so
 * the only way to see it work is to drive real inputs through and watch which
 * lane comes out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runConverter, resetBinCache } from "../../src/server/bridge.js";
import { runHarness } from "../../src/harness/harness.js";
import { buildNumber, buildBoolean, buildString, isPureString } from "runtime";
import type { TurnModel } from "../../src/types/turnout-model_pb.js";

const converterDir = resolve(__dirname, "../../../../go/converter");
const examplesDir = resolve(__dirname, "../../../../../spec/examples");
const tmpRoot = mkdtempSync(join(tmpdir(), "turnout-next-match-e2e-"));
const turnoutBin = join(tmpRoot, "turnout");
const goBin = process.env.GOROOT
  ? join(process.env.GOROOT, "bin", "go")
  : existsSync("/usr/local/go/bin/go")
    ? "/usr/local/go/bin/go"
    : "go";

let model: TurnModel;

beforeAll(async () => {
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
  resetBinCache();
  process.env.TURNOUT_BIN = turnoutBin;
  model = await runConverter(join(examplesDir, "shipping-dispatch-match.tu"), {
    strictParse: true,
  });
});

type Parcel = {
  zone: string;
  weightKg: number;
  fragile: boolean;
  declaredValue?: number;
};

function state(p: Parcel) {
  return {
    "parcel.zone": buildString(p.zone),
    "parcel.weight_kg": buildNumber(p.weightKg),
    "parcel.fragile": buildBoolean(p.fragile),
    "parcel.declared_value": buildNumber(p.declaredValue ?? 0),
  };
}

async function dispatch(p: Parcel) {
  const result = await runHarness({
    model,
    entryId: "dispatch_router",
    initialState: state(p),
  });
  if (result.trace.kind !== "scene") throw new Error("expected scene trace");

  const lane = result.finalState["dispatch.lane"];
  return {
    visited: result.trace.scene.actions.map((a) => a.actionId),
    lane: lane && isPureString(lane) ? lane.value : undefined,
    finalState: result.finalState,
  };
}

// ── arms select in order ─────────────────────────────────────────────────────

describe("next match — each arm selects its own action", () => {
  it("takes arm 1 for a light, sturdy domestic parcel", async () => {
    const { visited, lane } = await dispatch({ zone: "domestic", weightKg: 1, fragile: false });
    expect(visited).toEqual(["classify_parcel", "air_express"]);
    expect(lane).toBe("air_express");
  });

  it("takes arm 2 for a heavy, sturdy domestic parcel", async () => {
    const { visited, lane } = await dispatch({ zone: "domestic", weightKg: 40, fragile: false });
    expect(visited).toEqual(["classify_parcel", "ground_standard"]);
    expect(lane).toBe("ground_standard");
  });

  it("takes arm 4 for a light, sturdy export parcel", async () => {
    const { visited, lane } = await dispatch({ zone: "export", weightKg: 2, fragile: false });
    expect(visited).toEqual(["classify_parcel", "air_express"]);
    expect(lane).toBe("air_express");
  });
});

// ── a `_` column is genuinely unconstrained ──────────────────────────────────

describe("next match — a wildcard column matches every value", () => {
  // Arm 3 is `(_, _, true) => white_glove`: only `fragile` is read, so any
  // zone/weight combination reaches it as long as nothing above matched.
  it.each([
    ["domestic", 1],
    ["domestic", 40],
    ["export", 2],
    ["transit", 12],
  ])("routes a fragile %s parcel of %ikg to white_glove", async (zone, weightKg) => {
    const { visited, lane } = await dispatch({ zone, weightKg, fragile: true });
    expect(visited).toEqual(["classify_parcel", "white_glove"]);
    expect(lane).toBe("white_glove");
  });
});

// ── arm order decides overlaps ───────────────────────────────────────────────

describe("next match — the first matching arm wins", () => {
  // A light, sturdy domestic parcel matches arm 1. A light FRAGILE domestic
  // parcel skips arm 1 on the third column and falls to arm 3. Same first two
  // columns, different lane — which is the ordering doing the work.
  it("prefers the earlier arm when a later one also matches", async () => {
    const sturdy = await dispatch({ zone: "domestic", weightKg: 1, fragile: false });
    const fragile = await dispatch({ zone: "domestic", weightKg: 1, fragile: true });

    expect(sturdy.lane).toBe("air_express");
    expect(fragile.lane).toBe("white_glove");
  });
});

// ── the `_` arm catches the rest ─────────────────────────────────────────────

describe("next match — the `_` arm is the fallback", () => {
  it("holds a medium domestic parcel, which no arm names", async () => {
    // "medium" appears in no arm, so arms 1, 2 and 4 miss on the weight band
    // and arm 3 misses on fragile.
    const { visited } = await dispatch({ zone: "domestic", weightKg: 10, fragile: false });
    expect(visited[0]).toBe("classify_parcel");
    expect(visited[1]).toBe("hold_review");
  });

  it("holds an unknown zone", async () => {
    const { visited } = await dispatch({ zone: "interplanetary", weightKg: 1, fragile: false });
    expect(visited[1]).toBe("hold_review");
  });
});

// ── the single-subject form ──────────────────────────────────────────────────

describe("next match — single-subject form in hold_review", () => {
  it("defaults a low-value held parcel onto the ground lane", async () => {
    const { visited, lane } = await dispatch({
      zone: "interplanetary",
      weightKg: 1,
      fragile: false,
      declaredValue: 10,
    });
    expect(visited).toEqual(["classify_parcel", "hold_review", "ground_standard"]);
    expect(lane).toBe("ground_standard");
  });

  it("sends a high-value held parcel to the manual desk", async () => {
    const { visited, finalState } = await dispatch({
      zone: "interplanetary",
      weightKg: 1,
      fragile: false,
      declaredValue: 5000,
    });
    expect(visited).toEqual(["classify_parcel", "hold_review", "manual_desk"]);

    const manifest = finalState["dispatch.manifest"];
    expect(manifest && isPureString(manifest) && manifest.value).toBe("manual: light");
  });
});
