/**
 * E2E: ai_workflow scene
 *
 * Pipeline: workflow.turn → workflow.json → runHarness → STATE assertions.
 *
 * Scene: ai_workflow
 *   analyze ─[need_grounding & kb_enabled]→ retrieve → draft_with_context → safety_check
 *   analyze ─[fallthrough]──────────────→ draft_direct ──────────────────→ safety_check
 *   safety_check ─[toxicity ≤ 3]→ publish       (status = "sent")
 *   safety_check ─[fallthrough]──→ human_review  (status = "awaiting_human")
 */
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runServerHarness as runHarness } from '../../src/server/index.js';
import { buildBoolean, buildNumber, buildString, isPureString } from 'runtime';

const fixture = resolve(__dirname, '../fixtures/workflow.json');

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseState(overrides: Record<string, boolean | number | string> = {}) {
  const defaults: Record<string, boolean | number | string> = {
    'request.need_grounding': false,
    'request.kb_enabled': false,
    'request.toxicity_score': 0,
    'request.query': 'test question',
    'request.doc_hint': 'doc_ref',
  };
  const merged = { ...defaults, ...overrides };
  return Object.fromEntries(
    Object.entries(merged).map(([k, v]) => {
      if (typeof v === 'boolean') return [k, buildBoolean(v)];
      if (typeof v === 'number') return [k, buildNumber(v)];
      return [k, buildString(v as string)];
    }),
  );
}

function strVal(v: unknown): string | undefined {
  if (v && typeof v === 'object' && 'value' in v && typeof (v as { value: unknown }).value === 'string') {
    return (v as { value: string }).value;
  }
  return undefined;
}

// ─── retrieval path ──────────────────────────────────────────────────────────

describe('ai_workflow — retrieval path', () => {
  it('routes through retrieve when need_grounding=true and kb_enabled=true', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({
        'request.need_grounding': true,
        'request.kb_enabled': true,
        'request.query': 'hello',
        'request.doc_hint': 'some_doc',
      }),
    });

    expect(strVal(finalState['workflow.status'])).toBe('sent');
  });

  it('populates response.last with a non-empty string', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({
        'request.need_grounding': true,
        'request.kb_enabled': true,
        'request.query': 'hello',
        'request.doc_hint': 'ref_doc',
      }),
    });

    const last = finalState['response.last'];
    expect(isPureString(last!) && last.value.length > 0).toBe(true);
  });

  it('trace includes retrieve and draft_with_context', () => {
    const result = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({
        'request.need_grounding': true,
        'request.kb_enabled': true,
      }),
    });

    if (result.trace.kind !== 'scene') throw new Error('expected scene trace');
    const ids = result.trace.scene.actions.map((a) => a.actionId);
    expect(ids).toContain('retrieve');
    expect(ids).toContain('draft_with_context');
    expect(ids).not.toContain('draft_direct');
  });
});

// ─── direct draft path ───────────────────────────────────────────────────────

describe('ai_workflow — direct draft path', () => {
  it('routes through draft_direct when need_grounding=false', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({ 'request.query': 'my question' }),
    });

    expect(strVal(finalState['workflow.status'])).toBe('sent');
    // draft_direct produces "Direct answer: " + query
    const last = strVal(finalState['response.last']);
    expect(last?.startsWith('Direct answer:')).toBe(true);
  });

  it('trace includes draft_direct, not retrieve', () => {
    const result = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState(),
    });

    if (result.trace.kind !== 'scene') throw new Error('expected scene trace');
    const ids = result.trace.scene.actions.map((a) => a.actionId);
    expect(ids).toContain('draft_direct');
    expect(ids).not.toContain('retrieve');
    expect(ids).not.toContain('draft_with_context');
  });
});

// ─── human review path ───────────────────────────────────────────────────────

describe('ai_workflow — human review path', () => {
  it('routes to human_review when toxicity_score > 3', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({ 'request.toxicity_score': 5 }),
    });

    expect(strVal(finalState['workflow.status'])).toBe('awaiting_human');
  });

  it('populates review.note starting with "Review needed: "', () => {
    const { finalState } = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({
        'request.toxicity_score': 5,
        'request.query': 'bad question',
      }),
    });

    const note = strVal(finalState['review.note']);
    expect(note?.startsWith('Review needed:')).toBe(true);
  });

  it('trace includes human_review, not publish', () => {
    const result = runHarness({
      jsonFile: fixture,
      entryId: 'ai_workflow',
      initialState: baseState({ 'request.toxicity_score': 4 }),
    });

    if (result.trace.kind !== 'scene') throw new Error('expected scene trace');
    const ids = result.trace.scene.actions.map((a) => a.actionId);
    expect(ids).toContain('human_review');
    expect(ids).not.toContain('publish');
  });
});
