import { describe, it, expect } from "vitest";
import {
  evaluateMatchArm,
  selectNextScene,
  parseMatchArms,
} from "../src/executor/route-pattern.js";
import type { HistoryEntry } from "../src/executor/route-pattern.js";
import type { MatchArm } from "../src/types/turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function arm(target: string, ...patterns: string[]): MatchArm {
  return { patterns, target } as unknown as MatchArm;
}

/** Convert shorthand "sceneId.actionId" strings to HistoryEntry tuples. */
function h(...entries: string[]): HistoryEntry[] {
  return entries.map((e) => {
    const dot = e.indexOf(".");
    return { sceneId: e.slice(0, dot), actionId: e.slice(dot + 1) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMatchArm — catchall
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateMatchArm — catchall "_"', () => {
  it("matches any non-empty history", () => {
    expect(evaluateMatchArm(h("s1.action_a"), arm("x", "_"))).toBe(true);
  });

  it("matches empty history", () => {
    expect(evaluateMatchArm([], arm("x", "_"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMatchArm — exact patterns
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateMatchArm — exact "scene.action"', () => {
  it("matches when the block consists of exactly that one action", () => {
    expect(evaluateMatchArm(h("s1.final"), arm("x", "s1.final"))).toBe(true);
  });

  it("does not match when the block has a preceding action", () => {
    // Block for s1 = ['intro', 'final'] — exact requires block == ['final']
    expect(evaluateMatchArm(h("s1.intro", "s1.final"), arm("x", "s1.final"))).toBe(false);
  });

  it("does not match when the terminal action differs", () => {
    expect(evaluateMatchArm(h("s1.other"), arm("x", "s1.final"))).toBe(false);
  });

  it("does not match when the scene is absent from history", () => {
    expect(evaluateMatchArm(h("s2.action"), arm("x", "s1.final"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMatchArm — wildcard patterns
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateMatchArm — wildcard "scene.*.action"', () => {
  it("matches when the block ends with the action (single-action block)", () => {
    expect(evaluateMatchArm(h("s1.final"), arm("x", "s1.*.final"))).toBe(true);
  });

  it("matches when the block ends with the action (multi-action block)", () => {
    expect(evaluateMatchArm(h("s1.intro", "s1.quiz", "s1.final"), arm("x", "s1.*.final"))).toBe(
      true,
    );
  });

  it("does not match when the terminal action differs", () => {
    expect(evaluateMatchArm(h("s1.intro", "s1.other"), arm("x", "s1.*.final"))).toBe(false);
  });

  it('matches multi-segment suffix "scene.*.foo.bar"', () => {
    expect(evaluateMatchArm(h("s1.intro", "s1.foo", "s1.bar"), arm("x", "s1.*.foo.bar"))).toBe(
      true,
    );
  });

  it("does not match multi-segment suffix when block is too short", () => {
    expect(evaluateMatchArm(h("s1.bar"), arm("x", "s1.*.foo.bar"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contiguous-block semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateMatchArm — contiguous-block semantics", () => {
  it("only evaluates the FIRST contiguous block (interleaved history)", () => {
    // Spec §11: [s1.a, s2.x, s1.final] → first block for s1 = ['a']; s1.*.final does NOT match
    expect(evaluateMatchArm(h("s1.a", "s2.x", "s1.final"), arm("x", "s1.*.final"))).toBe(false);
  });

  it("matches via the first contiguous block (multiple-visit history)", () => {
    // Spec §11: [s1.a, s1.final, s2.x, s1.b, s1.final] → first block = ['a','final'] → matches s1.*.final
    expect(
      evaluateMatchArm(h("s1.a", "s1.final", "s2.x", "s1.b", "s1.final"), arm("x", "s1.*.final")),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateMatchArm — OR semantics
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateMatchArm — OR semantics", () => {
  it("matches when the first pattern matches", () => {
    expect(evaluateMatchArm(h("s1.final"), arm("x", "s1.final", "s2.end"))).toBe(true);
  });

  it("matches when only the second pattern matches", () => {
    expect(evaluateMatchArm(h("s2.end"), arm("x", "s1.final", "s2.end"))).toBe(true);
  });

  it("does not match when no pattern matches", () => {
    expect(evaluateMatchArm(h("s3.other"), arm("x", "s1.final", "s2.end"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectNextScene — no match
// ─────────────────────────────────────────────────────────────────────────────

// spec: scene-to-scene.md §route — no matching arm → route completes
describe("selectNextScene — no match", () => {
  it("returns null for empty arms array", () => {
    expect(selectNextScene(h("s1.final"), parseMatchArms([]), "s1")).toBeNull();
  });

  it("returns null when no arm pattern matches the history", () => {
    const arms = [arm("scene_b", "s1.other")];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBeNull();
  });

  // spec: scene-to-scene.md §route — currentSceneId filter prevents stale patterns
  it("returns null when the pattern scene differs from currentSceneId", () => {
    const arms = [arm("scene_b", "s1.final")];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s2")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectNextScene — single match
// ─────────────────────────────────────────────────────────────────────────────

// spec: scene-to-scene.md §route — basic arm selection
describe("selectNextScene — single match", () => {
  it("returns the matching arm target", () => {
    const arms = [arm("scene_b", "s1.final")];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("scene_b");
  });

  it("fallback matches regardless of currentSceneId", () => {
    const arms = [arm("fallback", "_")];
    expect(selectNextScene(h("s1.whatever"), parseMatchArms(arms), "s1")).toBe("fallback");
  });

  it("fallback fires for a different currentSceneId", () => {
    const arms = [arm("fallback", "_")];
    expect(selectNextScene(h("s2.done"), parseMatchArms(arms), "s2")).toBe("fallback");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// selectNextScene — priority
// ─────────────────────────────────────────────────────────────────────────────

// spec: scene-to-scene.md §route — priority: fewer wildcards > longer suffix > declaration order
describe("selectNextScene — priority", () => {
  it("exact (0 wildcards) beats wildcard (1 wildcard)", () => {
    const arms = [
      arm("wild_target", "s1.*.final"), // index 0, wildcard
      arm("exact_target", "s1.final"), // index 1, exact
    ];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("exact_target");
  });

  it("wildcard beats catchall", () => {
    const arms = [
      arm("catch_target", "_"), // index 0, catchall
      arm("wild_target", "s1.*.final"), // index 1, wildcard
    ];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("wild_target");
  });

  it('specific arm beats "_" even when "_" is declared first', () => {
    const arms = [
      arm("fallback", "_"), // index 0
      arm("specific", "s1.final"), // index 1
    ];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("specific");
  });

  it("longer suffix beats shorter suffix at equal wildcard count", () => {
    const arms = [
      arm("short", "s1.*.bar"), // suffix length 1
      arm("long", "s1.*.foo.bar"), // suffix length 2
    ];
    expect(selectNextScene(h("s1.a", "s1.foo", "s1.bar"), parseMatchArms(arms), "s1")).toBe("long");
  });

  it("declaration order breaks ties among equal-priority patterns", () => {
    const arms = [
      arm("first", "s1.*.final"), // index 0, wildcard, suffix 1
      arm("second", "s2.*.end"), // index 1, filtered out (wrong scene)
    ];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("first");
  });

  it("first declared arm wins when two have equal priority (same wildcard+suffix)", () => {
    // Both arms have 1 wildcard, suffix length 1
    const arms = [
      arm("first_target", "s1.*.final"), // index 0
      arm("second_target", "s1.*.final"), // index 1 — same pattern, different target
    ];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("first_target");
  });
});

describe("selectNextScene — per-arm best pattern", () => {
  it("uses the exact pattern when one arm has exact and wildcard matches", () => {
    const arms = [arm("target", "s1.*.final", "s1.final")];
    expect(selectNextScene(h("s1.final"), parseMatchArms(arms), "s1")).toBe("target");
  });

  it("uses the longer suffix when one arm has equal-wildcard matches", () => {
    const arms = [arm("target", "s1.*.final", "s1.*.intro.final")];
    expect(selectNextScene(h("s1.intro", "s1.final"), parseMatchArms(arms), "s1")).toBe("target");
  });
});
