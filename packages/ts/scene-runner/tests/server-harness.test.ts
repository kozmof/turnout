import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock bridge so tests don't need the actual go converter binary.
vi.mock("../src/server/bridge.js", () => ({
  runConverter: vi.fn(),
  loadJsonModel: vi.fn(),
}));

import { runConverter, loadJsonModel } from "../src/server/bridge.js";
import { runServerHarness } from "../src/server/harness.js";
import type { TurnModel } from "../src/types/turnout-model_pb.js";

const mockRunConverter = vi.mocked(runConverter);
const mockLoadJsonModel = vi.mocked(loadJsonModel);

const minimalModel = {
  scenes: [{ id: "scene_a", entryActions: ["act_a"], actions: [{ id: "act_a" }] }],
} as unknown as TurnModel;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("runServerHarness", () => {
  it("loads model from jsonFile and executes", async () => {
    mockLoadJsonModel.mockReturnValue(minimalModel);

    const result = await runServerHarness({
      jsonFile: "model.json",
      entryId: "scene_a",
      initialState: {},
    });

    expect(mockLoadJsonModel).toHaveBeenCalledWith("model.json");
    expect(result.trace.kind).toBe("scene");
  });

  it("loads model from turnFile via runConverter", async () => {
    mockRunConverter.mockResolvedValue(minimalModel);

    const result = await runServerHarness({
      turnFile: "my.turn",
      entryId: "scene_a",
      initialState: {},
    });

    expect(mockRunConverter).toHaveBeenCalledWith("my.turn");
    expect(result.trace.kind).toBe("scene");
  });

  it("resolves jsonFile within allowedBaseDir before loading", async () => {
    mockLoadJsonModel.mockReturnValue(minimalModel);

    const result = await runServerHarness({
      jsonFile: "nested/model.json",
      allowedBaseDir: "/workspace/models",
      entryId: "scene_a",
      initialState: {},
    });

    expect(mockLoadJsonModel).toHaveBeenCalledWith("/workspace/models/nested/model.json");
    expect(result.trace.kind).toBe("scene");
  });

  it("resolves turnFile within allowedBaseDir before converting", async () => {
    mockRunConverter.mockResolvedValue(minimalModel);

    const result = await runServerHarness({
      turnFile: "/workspace/models/story.turn",
      allowedBaseDir: "/workspace/models",
      entryId: "scene_a",
      initialState: {},
    });

    expect(mockRunConverter).toHaveBeenCalledWith("/workspace/models/story.turn");
    expect(result.trace.kind).toBe("scene");
  });

  it("rejects paths that resolve outside allowedBaseDir", async () => {
    await expect(
      runServerHarness({
        jsonFile: "../secret/model.json",
        allowedBaseDir: "/workspace/models",
        entryId: "scene_a",
        initialState: {},
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "PathOutsideBase" }));
    expect(mockLoadJsonModel).not.toHaveBeenCalled();
  });

  it("rejects sibling directories that only share the base prefix", async () => {
    await expect(
      runServerHarness({
        turnFile: "/workspace/models-other/story.turn",
        allowedBaseDir: "/workspace/models",
        entryId: "scene_a",
        initialState: {},
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "PathOutsideBase" }));
    expect(mockRunConverter).not.toHaveBeenCalled();
  });

  it("throws when both turnFile and jsonFile are provided", async () => {
    await expect(
      runServerHarness({
        turnFile: "story.turn",
        jsonFile: "model.json",
        entryId: "scene_a",
        initialState: {},
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "AmbiguousEntryPoint" }));
    expect(mockRunConverter).not.toHaveBeenCalled();
    expect(mockLoadJsonModel).not.toHaveBeenCalled();
  });

  it("throws when neither turnFile nor jsonFile is provided", async () => {
    await expect(
      runServerHarness({
        entryId: "scene_a",
        initialState: {},
      }),
    ).rejects.toThrow("either turnFile or jsonFile must be provided");
  });
});
