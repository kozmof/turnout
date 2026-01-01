import type { TagSymbol, AnyValue } from '../../state-control/value';
import {
  buildNumber,
  buildString,
  buildBoolean,
  buildArrayNumber,
  buildArrayString,
  buildArrayBoolean,
} from '../../state-control/value-builders';
import type { ValueRef, TransformRef } from './types';
import type { TransformFnNames } from '../types';

/**
 * Value builders for creating typed values.
 *
 * @example
 * ```typescript
 * val.number(42)
 * val.number(10, ['random'])
 * val.array('number', [val.number(1), val.number(2)])
 * ```
 */
export const val = {
  /**
   * Creates a NumberValue.
   */
  number(value: number, tags: TagSymbol[] = []): AnyValue {
    return buildNumber(value, tags);
  },

  /**
   * Creates a StringValue.
   */
  string(value: string, tags: TagSymbol[] = []): AnyValue {
    return buildString(value, tags);
  },

  /**
   * Creates a BooleanValue.
   */
  boolean(value: boolean, tags: TagSymbol[] = []): AnyValue {
    return buildBoolean(value, tags);
  },

  /**
   * Creates a typed ArrayValue.
   */
  array(
    elemType: 'number' | 'string' | 'boolean',
    elements: AnyValue[],
    tags: TagSymbol[] = []
  ): AnyValue {
    switch (elemType) {
      case 'number':
        return buildArrayNumber(elements, tags);
      case 'string':
        return buildArrayString(elements, tags);
      case 'boolean':
        return buildArrayBoolean(elements, tags);
    }
  },
};

/**
 * Reference helpers for working with value and function IDs.
 *
 * @example
 * ```typescript
 * ref.output('f1')  // Reference function output
 * ref.transform('v1', 'transformFnNumber::toStr')  // With transform
 * ```
 */
export const ref = {
  /**
   * References the output of a function.
   * Assumes function output is stored as `${funcId}__out`.
   */
  output(funcId: string): ValueRef {
    return `${funcId}__out`;
  },

  /**
   * Creates a reference with a transform function applied.
   */
  transform(valueId: ValueRef, transformFn: TransformFnNames): TransformRef {
    return {
      __type: 'transform',
      valueId,
      transformFn,
    };
  },
};
