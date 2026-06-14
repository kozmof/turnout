import type { BaseTypeSymbol } from "../value.js";

export type ElemType = Exclude<BaseTypeSymbol, "array">;
