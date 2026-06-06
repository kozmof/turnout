import { describe, it, expect } from 'vitest';
import { FN_MAP } from '../src/executor/hcl-context-builder.js';
import { getBinaryFnReturnType } from 'runtime';
import type { BinaryFnNames } from 'runtime';

// All HCL function names declared in the Go builtinFns registry (validate.go).
// Update this list when a new function is added to the Go DSL.
const GO_BUILTIN_FN_NAMES = [
  'add', 'sub', 'mul', 'div', 'mod', 'max', 'min',
  'gt', 'gte', 'lt', 'lte',
  'bool_and', 'bool_or', 'bool_xor',
  'str_concat', 'str_includes', 'str_starts', 'str_ends',
  'eq', 'neq',
  'arr_concat', 'arr_get', 'arr_includes',
] as const;

describe('FN_MAP coverage', () => {
  it('covers all Go builtin function names', () => {
    for (const name of GO_BUILTIN_FN_NAMES) {
      expect(FN_MAP, `FN_MAP is missing entry for Go builtin "${name}"`).toHaveProperty(name);
    }
  });

  it('all non-array FN_MAP values are valid runtime BinaryFnNames', () => {
    for (const [hclName, runtimeName] of Object.entries(FN_MAP)) {
      if (runtimeName.startsWith('binaryFnArray::')) continue;
      const returnType = getBinaryFnReturnType(runtimeName as BinaryFnNames);
      expect(
        returnType,
        `FN_MAP["${hclName}"] = "${runtimeName}" is not a known runtime BinaryFnName`,
      ).not.toBeNull();
    }
  });

  it('all array FN_MAP values follow the binaryFnArray:: namespace pattern', () => {
    const arrayFns = ['arr_concat', 'arr_get', 'arr_includes'] as const;
    for (const name of arrayFns) {
      expect(
        FN_MAP[name],
        `FN_MAP["${name}"] should start with "binaryFnArray::"`,
      ).toMatch(/^binaryFnArray::/);
    }
  });
});
