// AUTO-GENERATED — do not edit.
// Source of truth: spec/fn-aliases.json
// Regenerate: node --experimental-strip-types scripts/gen-fn-map.ts
import type { CombineFnNames } from "runtime";

export const FN_MAP: Record<string, CombineFnNames> = {
  add: "combineFnNumber::add",
  sub: "combineFnNumber::minus",
  mul: "combineFnNumber::multiply",
  div: "combineFnNumber::divide",
  mod: "combineFnNumber::mod",
  max: "combineFnNumber::max",
  min: "combineFnNumber::min",
  gt: "combineFnNumber::greaterThan",
  gte: "combineFnNumber::greaterThanOrEqual",
  lt: "combineFnNumber::lessThan",
  lte: "combineFnNumber::lessThanOrEqual",
  bool_and: "combineFnBoolean::and",
  bool_or: "combineFnBoolean::or",
  bool_xor: "combineFnBoolean::xor",
  str_concat: "combineFnString::concat",
  str_includes: "combineFnString::includes",
  str_starts: "combineFnString::startsWith",
  str_ends: "combineFnString::endsWith",
  template_extract: "combineFnString::extract",
  template_extract_num: "combineFnString::extractNum",
  eq: "combineFnGeneric::isEqual",
  neq: "combineFnGeneric::isNotEqual",
  arr_concat: "combineFnArray::concat",
  arr_get: "combineFnArray::get",
  arr_includes: "combineFnArray::includes",
  record_get: "combineFnRecord::getNumber",
  record_get_number: "combineFnRecord::getNumber",
  record_get_str: "combineFnRecord::getString",
  record_get_bool: "combineFnRecord::getBoolean",
  record_set: "combineFnRecord::set",
};
