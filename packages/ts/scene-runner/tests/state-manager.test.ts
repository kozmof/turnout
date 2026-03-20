import { describe, it, expect } from 'vitest';
import { StateManager } from '../src/state/state-manager.js';
import { buildNumber, buildString, buildBoolean, isPureNumber, isPureString, isPureBoolean } from 'runtime';
import type { StateModel } from '../src/types/scene-model.js';

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
    const model: StateModel = {
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
    };

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
