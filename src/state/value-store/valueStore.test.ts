import { expect, test, describe } from 'vitest';
import { createValueStore } from './valueStore';
describe('basic test', () => {
  test('getValue', () => {
    const { getValue } = createValueStore({
      key1: {
        value: { symbol: 'number', subSymbol: undefined, value: 100 },
        status: 'uneditable',
      },
    });
    expect(getValue('key1')?.value).toBe(100);
  });

  test('unkown key', () => {
    const { getValue } = createValueStore({
      key1: {
        value: { symbol: 'number', subSymbol: undefined, value: 100 },
        status: 'uneditable',
      },
    });
    expect(getValue('key2')).toBeNull();
  });

  test('getStatus', () => {
    const { geStatus } = createValueStore({
      key1: {
        value: { symbol: 'number', subSymbol: undefined, value: 100 },
        status: 'uneditable',
      },
    });
    expect(geStatus('key1')).toBe('uneditable');
  });

  test('updateValue', () => {
    const { updateValue, getValue } = createValueStore({
      key1: {
        value: { symbol: 'number', subSymbol: undefined, value: 100 },
        status: 'editable',
      },
    });
    updateValue('key1', {
      symbol: 'string',
      subSymbol: undefined,
      value: 'test',
    });
    expect(getValue('key1')?.value).toBe('test');
  });

  test('uneditable', () => {
    const { updateValue, getValue } = createValueStore({
      key1: {
        value: { symbol: 'number', subSymbol: undefined, value: 100 },
        status: 'uneditable',
      },
    });
    updateValue('key1', {
      symbol: 'string',
      subSymbol: undefined,
      value: 'test',
    });
    expect(getValue('key1')?.value).toBe(100);
  });
});
