import { expect, test } from 'vitest';
import { cartesianProduct } from './cartesianProduct';
test('basic test', () => {
  const product = cartesianProduct(
    ['add', 'minus', 'multiply', 'divide'],
    ['random', 'controlled'],
    ['number']
  );
  expect(product).toStrictEqual([
    ['add', 'random', 'number'],
    ['add', 'controlled', 'number'],
    ['minus', 'random', 'number'],
    ['minus', 'controlled', 'number'],
    ['multiply', 'random', 'number'],
    ['multiply', 'controlled', 'number'],
    ['divide', 'random', 'number'],
    ['divide', 'controlled', 'number'],
  ]);
});
