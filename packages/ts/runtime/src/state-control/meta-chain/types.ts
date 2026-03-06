import type { BaseTypeSymbol } from '../value';

export type ElemType = Exclude<BaseTypeSymbol, 'array'>;
