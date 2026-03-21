/**
 * Proto contract conformance tests for the Go→TS JSON boundary.
 *
 * The schema is now defined in schema/turnout-model.proto. Both Go and
 * TypeScript types are generated from that file, so structural drift is
 * caught at compile time. These runtime tests verify that:
 *   1. JSON fixture files can be loaded with fromJson (valid proto JSON).
 *   2. TypeScript can construct valid TurnModel values using the generated types.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromJson, type JsonObject } from '@bufbuild/protobuf';
import type { TurnModel, SceneBlock, ActionModel } from '../src/types/turnout-model_pb.js';
import { TurnModelSchema } from '../src/types/turnout-model_pb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

function loadFixture(name: string): TurnModel {
  const raw = readFileSync(resolve(fixturesDir, name), 'utf-8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return fromJson(TurnModelSchema, JSON.parse(raw) as JsonObject);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixture file tests
// ─────────────────────────────────────────────────────────────────────────────

describe('fixture files are valid proto JSON', () => {
  for (const fixture of ['workflow.json', 'scene-graph.json', 'two-scene-route.json']) {
    it(fixture, () => {
      expect(() => loadFixture(fixture)).not.toThrow();
      const model = loadFixture(fixture);
      expect(Array.isArray(model.scenes)).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Inline TurnModel type conformance (compile-time + shape check)
// ─────────────────────────────────────────────────────────────────────────────

describe('inline TurnModel type conformance', () => {
  it('accepts a minimal valid TurnModel', () => {
    const model = {
      scenes: [
        {
          id: 'test',
          entryActions: ['a'],
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
    } satisfies TurnModel;
    expect(Array.isArray(model.scenes)).toBe(true);
    expect(model.scenes[0]?.id).toBe('test');
  });

  it('accepts a TurnModel with state and routes', () => {
    const model = {
      state: {
        namespaces: [
          { name: 'user', fields: [{ name: 'active', type: 'bool', value: false }] },
        ],
      },
      scenes: [
        {
          id: 's',
          entryActions: ['a'],
          nextPolicy: 'first-match',
          actions: [{ id: 'a' }],
        } satisfies SceneBlock,
      ],
      routes: [
        { id: 'main', match: [{ patterns: ['_'], target: 's' }] },
      ],
    } satisfies TurnModel;
    expect(model.state?.namespaces).toHaveLength(1);
    expect(model.routes).toHaveLength(1);
  });
});
