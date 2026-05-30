import { describe, expect, it } from 'vitest';
import { migrateModel } from '../src/migration.js';
import type { TurnModel } from '../src/types/turnout-model_pb.js';

describe('migrateModel', () => {
  it('treats missing version as version 0 and migrates to current', () => {
    const model = {} as TurnModel;

    expect(migrateModel(model)).toBe(model);
  });

  it('returns current-version models unchanged', () => {
    const model = { version: 1 } as TurnModel;

    expect(migrateModel(model)).toBe(model);
  });

  it('rejects models requiring a newer runtime', () => {
    const model = { version: 1, minVersion: 2 } as TurnModel;

    expect(() => migrateModel(model)).toThrow(`below the model's required minimum version 2`);
  });

  it('rejects models above the maximum compatible runtime', () => {
    const model = { version: 1, maxVersion: 0.5 } as TurnModel;

    expect(() => migrateModel(model)).toThrow(`exceeds the model's maximum compatible version 0.5`);
  });

  it('rejects future schema versions', () => {
    const model = { version: 2 } as TurnModel;

    expect(() => migrateModel(model)).toThrow('Model schema version 2 is not supported');
  });
});
