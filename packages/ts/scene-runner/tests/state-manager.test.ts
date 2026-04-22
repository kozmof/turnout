import { describe, it, expect } from 'vitest';
import { StateManager, literalToValue } from '../src/state/state-manager.js';
import { buildNumber, buildString, buildBoolean, isPureNumber, isPureString, isPureBoolean, isPureNull, isArray } from 'runtime';
import type { StateModel } from '../src/types/turnout-model_pb.js';

describe('StateManager', () => {
  it('reads a value written with from()', () => {
    const sm = StateManager.from({ 'a.x': buildNumber(42) });
    const val = sm.read('a.x');
    expect(val).toBeDefined();
    expect(isPureNumber(val!) && val.value).toBe(42);
  });

  it('returns undefined for unknown path', () => {
    const sm = StateManager.from({});
    expect(sm.read('no.such.path')).toBeUndefined();
  });

  it('write returns a new instance with updated value', () => {
    const sm = StateManager.from({ 'a.x': buildNumber(1) });
    const sm2 = sm.write('a.x', buildNumber(99));
    expect(isPureNumber(sm.read('a.x')!) && sm.read('a.x')!.value).toBe(1);
    expect(isPureNumber(sm2.read('a.x')!) && sm2.read('a.x')!.value).toBe(99);
  });

  it('write does not mutate original', () => {
    const sm = StateManager.from({ 'a.x': buildNumber(5) });
    sm.write('a.x', buildNumber(500));
    expect(isPureNumber(sm.read('a.x')!) && sm.read('a.x')!.value).toBe(5);
  });

  it('snapshot returns a flat copy', () => {
    const sm = StateManager.from({ 'a.x': buildNumber(7), 'b.y': buildString('hi') });
    const snap = sm.snapshot();
    expect(Object.keys(snap)).toHaveLength(2);
    expect(isPureNumber(snap['a.x']) && snap['a.x'].value).toBe(7);
    expect(isPureString(snap['b.y']) && snap['b.y'].value).toBe('hi');
  });

  describe('fromSchema', () => {
    const model = {
      namespaces: [
        {
          name: 'request',
          fields: [
            { name: 'query', type: 'str', value: '' },
            { name: 'priority', type: 'number', value: 1 },
            { name: 'ready', type: 'bool', value: false },
          ],
        },
      ],
    } as unknown as StateModel;

    it('populates defaults from schema', () => {
      const sm = StateManager.fromSchema(model);
      const q = sm.read('request.query');
      const p = sm.read('request.priority');
      const r = sm.read('request.ready');
      expect(isPureString(q!) && q.value).toBe('');
      expect(isPureNumber(p!) && p.value).toBe(1);
      expect(isPureBoolean(r!) && r.value).toBe(false);
    });

    it('overrides take precedence over schema defaults', () => {
      const sm = StateManager.fromSchema(model, {
        'request.query': buildString('override'),
      });
      const q = sm.read('request.query');
      expect(isPureString(q!) && q.value).toBe('override');
      // other fields still have defaults
      const p = sm.read('request.priority');
      expect(isPureNumber(p!) && p.value).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// literalToValue edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('literalToValue', () => {
  it('returns buildNull("missing") for null', () => {
    const val = literalToValue(null, 'number');
    expect(isPureNull(val)).toBe(true);
  });

  it('returns buildNull("missing") for undefined', () => {
    const val = literalToValue(undefined, 'str');
    expect(isPureNull(val)).toBe(true);
  });

  it('handles arr<number> with a number array', () => {
    const val = literalToValue([1, 2, 3], 'arr<number>');
    expect(isArray(val)).toBe(true);
  });

  it('handles arr<str> with a string array', () => {
    const val = literalToValue(['a', 'b'], 'arr<str>');
    expect(isArray(val)).toBe(true);
  });

  it('handles arr<bool> with a boolean array', () => {
    const val = literalToValue([true, false], 'arr<bool>');
    expect(isArray(val)).toBe(true);
  });

  it('handles arr<number> with non-array value (falls back to empty array)', () => {
    const val = literalToValue('not-an-array', 'arr<number>');
    expect(isArray(val)).toBe(true);
  });

  it('returns buildNull("unknown") for an unrecognised type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = literalToValue('value', 'unknown' as any);
    expect(isPureNull(val)).toBe(true);
  });

  it('coerces a non-number value to number for type "number"', () => {
    const val = literalToValue('42', 'number');
    expect(isPureNumber(val!) && val.value).toBe(42);
  });

  it('coerces a non-string value to string for type "str"', () => {
    const val = literalToValue(99, 'str');
    expect(isPureString(val!) && val.value).toBe('99');
  });

  it('handles arr<str> with non-array value (falls back to empty array)', () => {
    const val = literalToValue('not-an-array', 'arr<str>');
    expect(isArray(val)).toBe(true);
  });

  it('handles arr<bool> with non-array value (falls back to empty array)', () => {
    const val = literalToValue('not-an-array', 'arr<bool>');
    expect(isArray(val)).toBe(true);
  });
});

describe('stateManagerFromSchema — array field types', () => {
  it('populates arr<number> defaults from schema', () => {
    const model = {
      namespaces: [
        {
          name: 'data',
          fields: [{ name: 'nums', type: 'arr<number>', value: [10, 20] }],
        },
      ],
    } as unknown as StateModel;
    const sm = StateManager.fromSchema(model);
    const val = sm.read('data.nums');
    expect(val).toBeDefined();
    expect(isArray(val!)).toBe(true);
  });

  it('populates arr<str> defaults from schema', () => {
    const model = {
      namespaces: [
        {
          name: 'data',
          fields: [{ name: 'tags', type: 'arr<str>', value: ['x', 'y'] }],
        },
      ],
    } as unknown as StateModel;
    const sm = StateManager.fromSchema(model);
    expect(isArray(sm.read('data.tags')!)).toBe(true);
  });

  it('populates arr<bool> defaults from schema', () => {
    const model = {
      namespaces: [
        {
          name: 'data',
          fields: [{ name: 'flags', type: 'arr<bool>', value: [true, false] }],
        },
      ],
    } as unknown as StateModel;
    const sm = StateManager.fromSchema(model);
    expect(isArray(sm.read('data.flags')!)).toBe(true);
  });
});
