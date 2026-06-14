// AUTO-GENERATED — do not edit.
// Source of truth: spec/fn-aliases.json
// Regenerate: node --experimental-strip-types scripts/gen-fn-map.ts
import type { BinaryFnNames } from "runtime";

export const FN_MAP: Record<string, BinaryFnNames> = {
  add: "binaryFnNumber::add",
  sub: "binaryFnNumber::minus",
  mul: "binaryFnNumber::multiply",
  div: "binaryFnNumber::divide",
  mod: "binaryFnNumber::mod",
  max: "binaryFnNumber::max",
  min: "binaryFnNumber::min",
  gt: "binaryFnNumber::greaterThan",
  gte: "binaryFnNumber::greaterThanOrEqual",
  lt: "binaryFnNumber::lessThan",
  lte: "binaryFnNumber::lessThanOrEqual",
  bool_and: "binaryFnBoolean::and",
  bool_or: "binaryFnBoolean::or",
  bool_xor: "binaryFnBoolean::xor",
  str_concat: "binaryFnString::concat",
  str_includes: "binaryFnString::includes",
  str_starts: "binaryFnString::startsWith",
  str_ends: "binaryFnString::endsWith",
  eq: "binaryFnGeneric::isEqual",
  neq: "binaryFnGeneric::isNotEqual",
  arr_concat: "binaryFnArray::concat",
  arr_get: "binaryFnArray::get",
  arr_includes: "binaryFnArray::includes",
};
