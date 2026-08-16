/**
 * E2E: proto schema-drift guard
 *
 * Converts representative .tu fixtures with the freshly-built Go binary and
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
  "01-vending-machine.tu",
  "02-incident-triage.tu",
  "03-warehouse-route.tu",
  "04-sensor-calibration.tu",
  "05-ticket-types.tu",
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

// Each committed JSON fixture is the converted output of its .tu source. These
// can silently rot when the grammar or emitter evolves but the .tu/.json pair
// is not regenerated. Assert the source still converts to the committed artifact.
const fixturePairs: Array<[turn: string, json: string]> = [
  ["workflow.tu", "workflow.json"],
  ["scene-graph-full.tu", "scene-graph.json"],
  ["two-scene-route.tu", "two-scene-route.json"],
];

describe("fixture .tu → committed .json consistency", () => {
  for (const [turn, json] of fixturePairs) {
    it(`${turn} converts to the committed ${json}`, async () => {
      const fromSource = await runConverter(join(fixturesDir, turn), { strictParse: true });
      const committed = loadJsonModel(join(fixturesDir, json), { strictParse: true });
      expect(fromSource).toEqual(committed);
    });
  }
});
