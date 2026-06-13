import type { MatchArm } from '../types/turnout-model_pb.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** One recorded step in the route execution history. */
export type HistoryEntry = { readonly sceneId: string; readonly actionId: string };

type ParsedPattern =
  | { kind: 'catchall' }
  | { kind: 'exact'; sceneId: string; suffix: string[] }    // 0 wildcards
  | { kind: 'wildcard'; sceneId: string; suffix: string[] } // 1 wildcard before suffix

/** A MatchArm with patterns pre-parsed — build once at model load time. */
export type ParsedMatchArm = {
  readonly patterns: readonly ParsedPattern[];
  readonly target: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

function parsePattern(raw: string): ParsedPattern {
  if (raw === '_') return { kind: 'catchall' };

  const parts = raw.split('.');
  const sceneId = parts[0];
  if (parts[1] === '*') {
    return { kind: 'wildcard', sceneId, suffix: parts.slice(2) };
  }
  return { kind: 'exact', sceneId, suffix: parts.slice(1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Contiguous-block extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the action IDs from the FIRST contiguous run of entries whose
 * `sceneId` matches the given scene.
 *
 * Returns [] if the scene does not appear in history.
 *
 * Per spec §11 edge cases: only the first contiguous block is used for
 * pattern matching. Later re-visits of the same scene are ignored.
 */
function extractFirstContiguousBlock(history: readonly HistoryEntry[], sceneId: string): string[] {
  let inBlock = false;
  const block: string[] = [];

  for (const entry of history) {
    if (entry.sceneId === sceneId) {
      inBlock = true;
      block.push(entry.actionId);
    } else if (inBlock) {
      // Block ended — stop; do not consider later re-entries.
      break;
    }
  }
  return block;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern matching
// ─────────────────────────────────────────────────────────────────────────────

function matchParsedPattern(pattern: ParsedPattern, history: readonly HistoryEntry[]): boolean {
  if (pattern.kind === 'catchall') return true;

  const block = extractFirstContiguousBlock(history, pattern.sceneId);
  if (block.length === 0) return false;

  if (pattern.kind === 'exact') {
    if (block.length !== pattern.suffix.length) return false;
    return block.every((a, i) => a === pattern.suffix[i]);
  }

  // wildcard: block must end with suffix
  const { suffix } = pattern;
  if (block.length < suffix.length) return false;
  const offset = block.length - suffix.length;
  return suffix.every((s, i) => block[offset + i] === s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority helpers
// ─────────────────────────────────────────────────────────────────────────────

function wildcardCount(p: ParsedPattern): number {
  if (p.kind === 'catchall') return Infinity;
  if (p.kind === 'wildcard') return 1;
  return 0;
}

function suffixLength(p: ParsedPattern): number {
  if (p.kind === 'catchall') return 0;
  return p.suffix.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-parse all patterns in a route's match arms once at model load time.
 * Pass the result to `selectNextScene` to avoid repeated string splitting on
 * every scene transition.
 */
export function parseMatchArms(arms: readonly MatchArm[]): ParsedMatchArm[] {
  return arms.map((arm) => ({
    patterns: arm.patterns.map(parsePattern),
    target: arm.target,
  }));
}

/**
 * Returns true if any pattern in `arm.patterns` matches `history` (OR semantics).
 * Does not apply current-scene filtering — use this for per-arm unit testing.
 */
export function evaluateMatchArm(history: readonly HistoryEntry[], arm: MatchArm): boolean {
  return arm.patterns.some((raw) => matchParsedPattern(parsePattern(raw), history));
}

/**
 * Selects the target scene for the highest-priority matching arm.
 *
 * `currentSceneId` is the scene that JUST terminated. A non-catchall pattern
 * `scene_X.*.action` is eligible only when `scene_X === currentSceneId`. This
 * prevents stale patterns from prior scenes firing again on subsequent evaluations
 * (which would cause infinite routing loops).
 *
 * Priority: fewer wildcards > longer suffix > declaration order (ASC index).
 * Returns null if no arm matches (route enters completed state).
 */
export function selectNextScene(
  history: readonly HistoryEntry[],
  arms: readonly ParsedMatchArm[],
  currentSceneId: string,
): string | null {
  type Candidate = { target: string; wildcards: number; suffixLen: number; index: number };
  const candidates: Candidate[] = [];

  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];

    // Filter patterns to those eligible for the current scene.
    // Catchall (_) is always eligible; scene-specific patterns only when sceneId matches.
    const eligibleParsed = arm.patterns
      .filter((p) => p.kind === 'catchall' || p.sceneId === currentSceneId);

    const matchingPatterns = eligibleParsed.filter((p) => matchParsedPattern(p, history));

    if (matchingPatterns.length === 0) continue;

    // Best pattern for this arm: fewest wildcards, then longest suffix.
    const best = matchingPatterns.reduce((a, b) => {
      const wA = wildcardCount(a);
      const wB = wildcardCount(b);
      if (wA !== wB) return wA < wB ? a : b;
      return suffixLength(a) >= suffixLength(b) ? a : b;
    });

    candidates.push({
      target: arm.target,
      wildcards: wildcardCount(best),
      suffixLen: suffixLength(best),
      index: i,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.wildcards !== b.wildcards) return a.wildcards - b.wildcards;
    if (a.suffixLen !== b.suffixLen) return b.suffixLen - a.suffixLen; // DESC
    return a.index - b.index; // ASC declaration order
  });

  return candidates[0].target;
}
