/**
 * E2E: proto schema-drift guard
 *
 * Converts representative .turn fixtures with the freshly-built Go binary and
 * parses the JSON output with `strictParse: true`, which rejects any unknown
 * proto field. This fails loudly if the Go emitter and the TS-side
 * `TurnModelSchema` drift apart — a class of bug the lenient production default
 * (`ignoreUnknownFields`) silently tolerates.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runConverter, loadJsonModel, resetBinCache } from "../../src/server/bridge.js";

const converterDir = resolve(__dirname, "../../../../go/converter");
const examplesDir = resolve(__dirname, "../../../../../spec/examples");
const fixturesDir = resolve(__dirname, "../fixtures");
const tmpRoot = mkdtempSync(join(tmpdir(), "turnout-drift-e2e-"));
const turnoutBin = join(tmpRoot, "turnout");
const goBin = process.env.GOROOT
  ? join(process.env.GOROOT, "bin", "go")
  : existsSync("/usr/local/go/bin/go")
    ? "/usr/local/go/bin/go"
    : "go";

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
  resetBinCache();
  process.env.TURNOUT_BIN = turnoutBin;
});

// Canonical examples spanning scenes, routes, actions, STATE effects, and
// local expressions — the broadest exercise of the proto surface available.
const examples = [
  "adventure-story-graph-with-actions.turn",
  "customer-onboarding-multi-scene.turn",
  "detective-phase.turn",
  "llm-workflow-with-actions.turn",
  "scene-graph-with-actions.turn",
];

describe("proto schema-drift guard", () => {
  for (const example of examples) {
    it(`converts ${example} with no unknown proto fields`, async () => {
      const model = await runConverter(join(examplesDir, example), { strictParse: true });
      // A successful strict parse is the assertion; sanity-check it produced a model.
      expect(model.scenes.length + model.routes.length).toBeGreaterThan(0);
    });
  }
});

// Each committed JSON fixture is the converted output of its .turn source. These
// can silently rot when the grammar or emitter evolves but the .turn/.json pair
// is not regenerated. Assert the source still converts to the committed artifact.
const fixturePairs: Array<[turn: string, json: string]> = [
  ["workflow.turn", "workflow.json"],
  ["scene-graph-full.turn", "scene-graph.json"],
  ["two-scene-route.turn", "two-scene-route.json"],
];

describe("fixture .turn → committed .json consistency", () => {
  for (const [turn, json] of fixturePairs) {
    it(`${turn} converts to the committed ${json}`, async () => {
      const fromSource = await runConverter(join(fixturesDir, turn), { strictParse: true });
      const committed = loadJsonModel(join(fixturesDir, json), { strictParse: true });
      expect(fromSource).toEqual(committed);
    });
  }
});
