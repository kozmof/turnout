/**
 * E2E: transition match blocks (`next on (...) match { }`)
 *
 * Pipeline: 02-incident-triage.tu → Go converter → runHarness → trace and
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
 * action comes out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runConverter, resetBinCache } from "../../src/server/bridge.js";
import { runHarness } from "../../src/harness/harness.js";
import { buildNumber, buildBoolean, buildString, isPureString } from "runtime";
import type { HookRegistry } from "../../src/types/harness-types.js";
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

// The example takes one prepare hook and publishes to several others. Publish
// hooks are read-only and their return values ignored, so no-ops are enough.
const hooks: HookRegistry = {
  prepare: {
    // Hook fields must be typed values, not bare JS primitives.
    oncall_roster: () => ({ oncall_owner: buildString("ada") }),
  },
  publish: {
    incident_timeline: () => {},
    metrics: () => {},
    pager: () => {},
    exec_bridge: () => {},
    ticket_tracker: () => {},
  },
};

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
  model = await runConverter(join(examplesDir, "02-incident-triage.tu"), {
    strictParse: true,
  });
});

type Incident = {
  severity: number;
  affectedServices: number;
  customerFacing: boolean;
};

async function triage(i: Incident) {
  const result = await runHarness({
    model,
    entryId: "incident_response",
    initialState: {
      "incident.severity": buildNumber(i.severity),
      "incident.affected_services": buildNumber(i.affectedServices),
      "incident.customer_facing": buildBoolean(i.customerFacing),
      "incident.summary": buildString(""),
    },
    hooks,
  });
  if (result.trace.kind !== "scene") throw new Error("expected scene trace");

  const tier = result.finalState["triage.tier"];
  return {
    visited: result.trace.scene.actions.map((a) => a.actionId),
    tier: tier && isPureString(tier) ? tier.value : undefined,
  };
}

// ── arms select in order ─────────────────────────────────────────────────────

describe("next match — each arm selects its own action", () => {
  it("takes arm 1: a wide, customer-facing critical incident wakes leadership", async () => {
    const { visited, tier } = await triage({
      severity: 9,
      affectedServices: 5,
      customerFacing: true,
    });
    expect(tier).toBe("critical");
    expect(visited).toEqual(["classify_incident", "page_leadership"]);
  });

  it("takes arm 2: a contained, customer-facing critical incident pages on-call", async () => {
    const { visited } = await triage({
      severity: 9,
      affectedServices: 1,
      customerFacing: true,
    });
    expect(visited.slice(0, 2)).toEqual(["classify_incident", "page_oncall"]);
  });

  it("takes arm 4: a wide, customer-facing major incident pages on-call", async () => {
    const { visited, tier } = await triage({
      severity: 6,
      affectedServices: 5,
      customerFacing: true,
    });
    expect(tier).toBe("major");
    expect(visited.slice(0, 2)).toEqual(["classify_incident", "page_oncall"]);
  });
});

// ── a `_` column is genuinely unconstrained ──────────────────────────────────

describe("next match — a wildcard column matches every value", () => {
  // Arm 3 is `("critical", _, false) => page_oncall`: the blast column is not
  // read at all, so a non-customer-facing critical incident reaches it whether
  // it is wide or contained.
  it.each([
    ["contained", 1],
    ["wide", 5],
    ["wider", 12],
  ])("routes a %s internal critical incident to page_oncall", async (_label, affectedServices) => {
    const { visited } = await triage({
      severity: 9,
      affectedServices,
      customerFacing: false,
    });
    expect(visited.slice(0, 2)).toEqual(["classify_incident", "page_oncall"]);
  });
});

// ── arm order decides overlaps ───────────────────────────────────────────────

describe("next match — the first matching arm wins", () => {
  // A wide critical incident matches arm 1 when customer-facing and arm 3 when
  // not. Same first two columns, different action — the ordering doing the work.
  it("prefers the earlier arm when a later one also matches", async () => {
    const external = await triage({ severity: 9, affectedServices: 5, customerFacing: true });
    const internal = await triage({ severity: 9, affectedServices: 5, customerFacing: false });

    expect(external.visited[1]).toBe("page_leadership");
    expect(internal.visited[1]).toBe("page_oncall");
  });
});

// ── the `_` arm catches the rest ─────────────────────────────────────────────

describe("next match — the `_` arm is the fallback", () => {
  it("watches a minor incident, which no arm names", async () => {
    const { visited, tier } = await triage({
      severity: 2,
      affectedServices: 1,
      customerFacing: true,
    });
    expect(tier).toBe("minor");
    expect(visited.slice(0, 2)).toEqual(["classify_incident", "watch_only"]);
  });

  it("watches a contained major incident, which misses arm 4 on blast", async () => {
    const { visited } = await triage({
      severity: 6,
      affectedServices: 1,
      customerFacing: true,
    });
    expect(visited.slice(0, 2)).toEqual(["classify_incident", "watch_only"]);
  });
});

// ── the single-subject form ──────────────────────────────────────────────────

describe("next match — single-subject form in watch_only", () => {
  it("opens a ticket when a watched incident is spreading", async () => {
    const { visited } = await triage({
      severity: 2,
      affectedServices: 5,
      customerFacing: true,
    });
    expect(visited).toEqual(["classify_incident", "watch_only", "open_ticket"]);
  });

  it("stops at watch_only_end when a watched incident is steady", async () => {
    const { visited } = await triage({
      severity: 2,
      affectedServices: 1,
      customerFacing: true,
    });
    expect(visited).toEqual(["classify_incident", "watch_only", "watch_only_end"]);
  });
});

// ── the block form still behaves ─────────────────────────────────────────────

describe("next match — a match block coexists with a block-form transition", () => {
  // page_oncall's follow-up is a plain `next { }` rule guarded by a comparison,
  // which the match form cannot express. It fires only above the ticket floor.
  it("files a follow-up ticket for a severe paged incident", async () => {
    const { visited } = await triage({
      severity: 9,
      affectedServices: 1,
      customerFacing: true,
    });
    expect(visited).toEqual(["classify_incident", "page_oncall", "open_ticket"]);
  });
});
