import { toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type {
  LiteralTypeExpr,
  TemplateSegmentModel,
  TemplateTypeExpr,
  TurnModel,
  TypeExpr,
} from "../types/turnout-model_pb.js";

// ─────────────────────────────────────────────────────────────────────────────
// Template matching and capture decoding (literal-template-types-spec.md §8, §19)
//
// Runtime counterpart of the Go converter's ast.TemplateMatch. It MUST stay
// behaviourally identical to that implementation — both are exercised by the
// shared cross-language conformance fixtures (§28.8).
//
// Template validation (in the converter) rejects adjacent captures and
// non-terminal `str` captures, so every capture is either the final segment or
// is followed by a static-text segment. Matching is a deterministic
// left-to-right scan with no regex and no implicit greediness (§7.5). Decoded
// captures use their runtime types (§19.2): integer/number → number, bool →
// boolean, str / string literal → string.
// ─────────────────────────────────────────────────────────────────────────────

export type CaptureValue = string | number | boolean;

export type MatchResult =
  | { readonly matched: true; readonly captures: Record<string, CaptureValue> }
  | { readonly matched: false };

/** TypeRegistry resolves named type references to their declared type. */
export type TypeRegistry = ReadonlyMap<string, TypeExpr>;

/** buildTypeRegistry indexes a model's type declarations by name. */
export function buildTypeRegistry(model: TurnModel): TypeRegistry {
  const reg = new Map<string, TypeExpr>();
  for (const decl of model.typeDecls) {
    if (decl.type && !reg.has(decl.name)) reg.set(decl.name, decl.type);
  }
  return reg;
}

/** matchTemplate decodes input against tmpl, resolving named captures via registry. */
export function matchTemplate(
  tmpl: TemplateTypeExpr,
  input: string,
  registry: TypeRegistry,
): MatchResult {
  const caps: Record<string, CaptureValue> = {};
  if (matchSegments(tmpl.segments, input, caps, registry)) {
    return { matched: true, captures: caps };
  }
  return { matched: false };
}

/** templateContains reports whether input is a member of the template type. */
export function templateContains(
  tmpl: TemplateTypeExpr,
  input: string,
  registry: TypeRegistry,
): boolean {
  return matchTemplate(tmpl, input, registry).matched;
}

function matchSegments(
  segs: readonly TemplateSegmentModel[],
  s: string,
  caps: Record<string, CaptureValue>,
  registry: TypeRegistry,
): boolean {
  const [seg, ...rest] = segs;
  if (seg === undefined) return s === "";
  if (seg.segment.case === "text") {
    const text = seg.segment.value.value;
    if (!s.startsWith(text)) return false;
    return matchSegments(rest, s.slice(text.length), caps, registry);
  }
  if (seg.segment.case !== "capture") return false;
  const capture = seg.segment.value;
  const captureType = capture.type;
  if (captureType === undefined) return false;

  if (rest.length === 0) {
    const decoded = decodeCapture(s, captureType, registry);
    if (decoded === NO_MATCH) return false;
    caps[capture.name] = decoded;
    return true;
  }

  // Bounded capture: try each non-empty prefix as the value.
  for (let end = 1; end <= s.length; end++) {
    const decoded = decodeCapture(s.slice(0, end), captureType, registry);
    if (decoded === NO_MATCH) continue;
    const trial: Record<string, CaptureValue> = { ...caps, [capture.name]: decoded };
    if (matchSegments(rest, s.slice(end), trial, registry)) {
      Object.assign(caps, trial);
      return true;
    }
  }
  return false;
}

// NO_MATCH is a unique sentinel distinct from any valid decoded value (a decoded
// value may legitimately be the string "", the number 0, or the boolean false).
const NO_MATCH: unique symbol = Symbol("no-match");
type Decoded = CaptureValue | typeof NO_MATCH;

function resolve(t: TypeExpr, registry: TypeRegistry): TypeExpr {
  let current = t;
  const seen = new Set<string>();
  while (current.type.case === "named") {
    const name = current.type.value.name;
    if (seen.has(name)) return current;
    seen.add(name);
    const next = registry.get(name);
    if (next === undefined) return current;
    current = next;
  }
  return current;
}

function decodeCapture(value: string, t: TypeExpr, registry: TypeRegistry): Decoded {
  if (value === "") return NO_MATCH; // captures never match the empty string
  const resolved = resolve(t, registry);
  switch (resolved.type.case) {
    case "primitive": {
      switch (resolved.type.value.name) {
        case "str":
          return value;
        case "integer": {
          const n = parseCanonicalInteger(value);
          return n === undefined ? NO_MATCH : n;
        }
        case "number": {
          const n = parseCanonicalNumber(value);
          return n === undefined ? NO_MATCH : n;
        }
        case "bool":
          if (value === "true") return true;
          if (value === "false") return false;
          return NO_MATCH;
        default:
          return NO_MATCH;
      }
    }
    case "literal":
      return decodeLiteral(value, resolved.type.value);
    case "union": {
      for (const member of resolved.type.value.members) {
        const decoded = decodeCapture(value, member, registry);
        if (decoded !== NO_MATCH) return decoded;
      }
      return NO_MATCH;
    }
    default:
      return NO_MATCH;
  }
}

function decodeLiteral(value: string, lit: LiteralTypeExpr): Decoded {
  const raw = lit.value ? toJson(ValueSchema, lit.value) : undefined;
  switch (lit.base) {
    case "str":
      return value === raw ? value : NO_MATCH;
    case "integer": {
      const n = parseCanonicalInteger(value);
      return n !== undefined && n === raw ? n : NO_MATCH;
    }
    case "number": {
      const n = parseCanonicalNumber(value);
      return n !== undefined && n === raw ? n : NO_MATCH;
    }
    case "bool": {
      if (value !== "true" && value !== "false") return NO_MATCH;
      const b = value === "true";
      return b === raw ? b : NO_MATCH;
    }
    default:
      return NO_MATCH;
  }
}

/**
 * Accepts an optionally-negative decimal integer in canonical form: "0", or
 * [1-9][0-9]*, optionally prefixed with '-' (but not "-0"). Rejects leading
 * zeros, '+', decimals, and exponents (§7.4, §28.4).
 */
function parseCanonicalInteger(s: string): number | undefined {
  let digits = s;
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    digits = s.slice(1);
  }
  if (!isCanonicalDigits(digits)) return undefined;
  if (neg && digits === "0") return undefined; // "-0" is not canonical
  return parseFiniteFloat64(s);
}

/**
 * Accepts a canonical decimal: a canonical integer part optionally followed by
 * '.' and one or more digits. Rejects trailing/leading '.', '+', leading zeros,
 * and exponents.
 */
function parseCanonicalNumber(s: string): number | undefined {
  let intPart = s;
  let fracPart = "";
  const dot = s.indexOf(".");
  if (dot >= 0) {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
    if (fracPart === "" || !isDigits(fracPart)) return undefined;
  }
  let digits = intPart;
  let neg = false;
  if (intPart.startsWith("-")) {
    neg = true;
    digits = intPart.slice(1);
  }
  if (!isCanonicalDigits(digits)) return undefined;
  if (neg && digits === "0" && fracPart === "") return undefined;
  return parseFiniteFloat64(s);
}

// Match Go's strconv.ParseFloat(..., 64): reject overflow.
function parseFiniteFloat64(s: string): number | undefined {
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function isCanonicalDigits(s: string): boolean {
  if (s === "0") return true;
  if (s === "" || s.charCodeAt(0) === 48 /* '0' */) return false;
  return isDigits(s);
}

function isDigits(s: string): boolean {
  if (s === "") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false; // '0'..'9'
  }
  return true;
}
