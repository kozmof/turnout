import { expect, test } from 'vitest';
import strEnum from './strEnum';

// Note: [NML]️ is a normal test. [NEG]️ is a negative test

test('Create Enum [NML]️', () => {
  expect(strEnum(['a', 'b', 'c'])).toEqual({
    a: 'a',
    b: 'b',
    c: 'c'
  });
});
