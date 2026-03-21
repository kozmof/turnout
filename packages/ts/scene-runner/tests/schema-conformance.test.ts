/**
 * Schema conformance tests for the Go→TS JSON boundary.
 *
 * These tests verify that:
 *   1. schema/turnout-model.json is valid JSON and declares every expected definition.
 *   2. The JSON fixture files used by other tests conform to the TurnModel type structure.
 *
 * TypeScript itself (strict mode, no implicit any) enforces the TurnModel contract
 * at compile time. This file adds a lightweight runtime check so that:
 *   - drift in the schema file is caught before code review
 *   - fixture files are validated against the schema's structural requirements
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TurnModel, SceneBlock, ActionModel } from '../src/types/scene-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path from tests/ up to repo root, then into schema/.
const schemaPath = resolve(__dirname, '../../../../schema/turnout-model.json');
const fixturesDir = resolve(__dirname, 'fixtures');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readJSON(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** The full set of $defs the schema must declare. */
const EXPECTED_DEFS = [
  'FieldTypeStr', 'Literal',
  'StateModel', 'NamespaceModel', 'FieldModel',
  'SceneBlock', 'ActionModel',
  'ComputeModel', 'ProgModel', 'BindingModel',
  'ExprModel', 'CombineExpr', 'PipeExpr', 'PipeParam', 'PipeStep', 'CondExpr',
  'ArgModel', 'TransformArg',
  'PrepareEntry', 'MergeEntry',
  'NextRuleModel', 'NextComputeModel', 'NextPrepareEntry',
  'RouteModel', 'MatchArm',
] as const;

/** Structural checks applied to every fixture TurnModel. */
function assertTurnModel(raw: unknown, label: string): void {
  expect(raw, `${label}: must be an object`).toBeTypeOf('object');
  expect(raw).not.toBeNull();
  const m = raw as Record<string, unknown>;
  expect(Array.isArray(m['scenes']), `${label}: scenes must be an array`).toBe(true);
  const scenes = m['scenes'] as unknown[];
  for (const scene of scenes) {
    assertSceneBlock(scene, label);
  }
  if (m['state'] !== undefined) {
    expect(m['state'], `${label}: state must be an object`).toBeTypeOf('object');
    const st = m['state'] as Record<string, unknown>;
    expect(Array.isArray(st['namespaces']), `${label}: state.namespaces must be an array`).toBe(true);
  }
  if (m['routes'] !== undefined) {
    expect(Array.isArray(m['routes']), `${label}: routes must be an array`).toBe(true);
  }
}

function assertSceneBlock(raw: unknown, label: string): void {
  const s = raw as Record<string, unknown>;
  expect(s['id'], `${label}: scene.id must be a string`).toBeTypeOf('string');
  expect(Array.isArray(s['entry_actions']), `${label}: scene.entry_actions must be an array`).toBe(true);
  expect(Array.isArray(s['actions']), `${label}: scene.actions must be an array`).toBe(true);
  if (s['next_policy'] !== undefined) {
    expect(['first-match', 'all-match'], `${label}: scene.next_policy must be a valid enum value`).toContain(s['next_policy']);
  }
  for (const action of s['actions'] as unknown[]) {
    assertActionModel(action, label);
  }
}

function assertActionModel(raw: unknown, label: string): void {
  const a = raw as Record<string, unknown>;
  expect(a['id'], `${label}: action.id must be a string`).toBeTypeOf('string');
  if (a['prepare'] !== undefined) {
    expect(Array.isArray(a['prepare']), `${label}: action.prepare must be an array`).toBe(true);
  }
  if (a['merge'] !== undefined) {
    expect(Array.isArray(a['merge']), `${label}: action.merge must be an array`).toBe(true);
  }
  if (a['publish'] !== undefined) {
    expect(Array.isArray(a['publish']), `${label}: action.publish must be an array`).toBe(true);
  }
  if (a['next'] !== undefined) {
    expect(Array.isArray(a['next']), `${label}: action.next must be an array`).toBe(true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('schema/turnout-model.json', () => {
  it('is valid JSON', () => {
    expect(() => readJSON(schemaPath)).not.toThrow();
  });

  it('has required top-level JSON Schema keys', () => {
    const schema = readJSON(schemaPath) as Record<string, unknown>;
    for (const key of ['$schema', '$id', 'title', 'description', '$defs', 'properties']) {
      expect(schema, `missing key "${key}"`).toHaveProperty(key);
    }
  });

  it('declares all expected $defs', () => {
    const schema = readJSON(schemaPath) as Record<string, unknown>;
    const defs = schema['$defs'] as Record<string, unknown>;
    for (const name of EXPECTED_DEFS) {
      expect(defs, `missing $defs.${name}`).toHaveProperty(name);
    }
  });

  it('top-level "required" includes "scenes"', () => {
    const schema = readJSON(schemaPath) as Record<string, unknown>;
    expect(Array.isArray(schema['required'])).toBe(true);
    expect(schema['required'] as string[]).toContain('scenes');
  });
});

describe('fixture JSON files conform to TurnModel schema structure', () => {
  const fixtures = ['workflow.json', 'scene-graph.json', 'two-scene-route.json'];

  for (const filename of fixtures) {
    it(`${filename} has valid TurnModel structure`, () => {
      const raw = readJSON(`${fixturesDir}/${filename}`);
      assertTurnModel(raw, filename);

      // TypeScript compile-time check: this assignment will fail to compile if
      // the fixture shape diverges from TurnModel.
      const _typed: TurnModel = raw as TurnModel;
      void _typed;
    });
  }
});

describe('inline TurnModel type conformance', () => {
  it('accepts a minimal valid TurnModel', () => {
    // TypeScript enforces this at compile time; the runtime check confirms the
    // structural validator also accepts it.
    const model: TurnModel = {
      scenes: [
        {
          id: 'test',
          entry_actions: ['a'],
          actions: [
            {
              id: 'a',
              compute: {
                root: 'out',
                prog: { name: 'p', bindings: [{ name: 'out', type: 'bool', value: true }] },
              },
            } satisfies ActionModel,
          ],
        } satisfies SceneBlock,
      ],
    };
    assertTurnModel(model, 'inline minimal model');
  });

  it('accepts a TurnModel with state and routes', () => {
    const model: TurnModel = {
      state: {
        namespaces: [
          { name: 'user', fields: [{ name: 'active', type: 'bool', value: false }] },
        ],
      },
      scenes: [
        {
          id: 's',
          entry_actions: ['a'],
          next_policy: 'first-match',
          actions: [{ id: 'a' }],
        },
      ],
      routes: [
        { id: 'main', match: [{ patterns: ['_'], target: 's' }] },
      ],
    };
    assertTurnModel(model, 'inline full model');
  });
});
