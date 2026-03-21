import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { loadTurnFile, loadJsonModel, runConverter, convertToHCL } from '../src/server/bridge.js';
import type { TurnModel } from '../src/types/turnout-model_pb.js';

const mockReadFile = vi.mocked(readFileSync) as unknown as ReturnType<typeof vi.fn>;
const mockExecFile = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;
const mockExecSync = vi.mocked(execSync) as unknown as ReturnType<typeof vi.fn>;

const minimalModel: TurnModel = {
  scenes: [{ id: 'scene_a', entryActions: [], actions: [] }],
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// loadTurnFile
// ─────────────────────────────────────────────────────────────────────────────

describe('loadTurnFile', () => {
  it('reads and returns file content as a string', () => {
    mockReadFile.mockReturnValue('turn file content');
    const result = loadTurnFile('test.turn');
    expect(result).toBe('turn file content');
    expect(mockReadFile).toHaveBeenCalledWith('test.turn', 'utf8');
  });

  it('wraps read errors with a descriptive message', () => {
    mockReadFile.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    expect(() => loadTurnFile('missing.turn')).toThrow(
      'Cannot read turn file "missing.turn": ENOENT: no such file',
    );
  });

  it('handles non-Error exceptions', () => {
    mockReadFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw string error';
    });
    expect(() => loadTurnFile('bad.turn')).toThrow('Cannot read turn file');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// loadJsonModel
// ─────────────────────────────────────────────────────────────────────────────

describe('loadJsonModel', () => {
  it('parses and returns a valid JSON model', () => {
    mockReadFile.mockReturnValue(JSON.stringify(minimalModel));
    const result = loadJsonModel('model.json');
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].id).toBe('scene_a');
  });

  it('wraps file-read errors with a descriptive message', () => {
    mockReadFile.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    expect(() => loadJsonModel('secret.json')).toThrow(
      'Cannot read JSON model "secret.json": Permission denied',
    );
  });

  it('wraps non-Error file-read failures', () => {
    mockReadFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'disk error';
    });
    expect(() => loadJsonModel('secret.json')).toThrow('Cannot read JSON model "secret.json"');
  });

  it('wraps invalid JSON with a descriptive message', () => {
    mockReadFile.mockReturnValue('not valid json {{{');
    expect(() => loadJsonModel('bad.json')).toThrow('Invalid JSON from "bad.json"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runConverter
// ─────────────────────────────────────────────────────────────────────────────

describe('runConverter', () => {
  it('invokes the turnout binary and returns the parsed model', () => {
    // execSync succeeds → binary is on PATH
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockReturnValue(Buffer.from(JSON.stringify(minimalModel)));

    const result = runConverter('my.turn');
    expect(result.scenes[0].id).toBe('scene_a');
    expect(mockExecFile).toHaveBeenCalled();
  });

  it('wraps converter failures with a descriptive message', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockImplementation(() => {
      throw new Error('exit code 1');
    });
    expect(() => runConverter('my.turn')).toThrow('turnout converter failed for "my.turn"');
  });

  it('wraps non-Error converter failures', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'raw string failure';
    });
    expect(() => runConverter('my.turn')).toThrow('turnout converter failed for "my.turn"');
  });

  it('falls back to the built binary when turnout is not on PATH', () => {
    // execSync throws → turnout not on PATH → falls back to built binary path
    mockExecSync.mockImplementation(() => {
      throw new Error('not found');
    });
    mockExecFile.mockReturnValue(Buffer.from(JSON.stringify(minimalModel)));

    const result = runConverter('my.turn');
    expect(result.scenes).toHaveLength(1);
    // execFile should have been called with the fallback binary path (ends with /turnout)
    const calledBin = mockExecFile.mock.calls[0][0] as string;
    expect(calledBin).toMatch(/turnout$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// convertToHCL
// ─────────────────────────────────────────────────────────────────────────────

describe('convertToHCL', () => {
  it('returns the HCL output as a string', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockReturnValue(Buffer.from('hcl content here'));

    const result = convertToHCL('my.turn');
    expect(result).toBe('hcl content here');
  });

  it('wraps converter failures with a descriptive message', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockImplementation(() => {
      throw new Error('converter error');
    });
    expect(() => convertToHCL('my.turn')).toThrow('turnout converter failed for "my.turn"');
  });

  it('wraps non-Error failures', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    mockExecFile.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 42;
    });
    expect(() => convertToHCL('my.turn')).toThrow('turnout converter failed for "my.turn"');
  });
});
