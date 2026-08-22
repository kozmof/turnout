// Runtime capture extraction for template literal types (literal-template-types-spec.md §19).
//
// The Go converter lowers a template `case` arm into `combineFnString::extract`
// combines whose second argument is a JSON spec describing the (fully-resolved)
// template and the capture to read. This module parses that spec and returns the
// raw captured substring; type conversion (to number/bool) is applied downstream
// via existing transforms. The matcher mirrors the converter's ast.TemplateMatch
// boundary logic: no regex, no greediness — every capture is bounded by static
// text or is the final segment.

interface TextSpecSeg {
  readonly text: string;
}
interface CaptureSpecSeg {
  // t: "str" | "integer" | "number" | "bool" | "enum"
  readonly cap: string;
  readonly t: string;
  readonly vals?: readonly string[]; // present when t === "enum"
}
type SpecSeg = TextSpecSeg | CaptureSpecSeg;

interface ExtractSpec {
  readonly want: string;
  readonly segs: readonly SpecSeg[];
}

function isCapture(seg: SpecSeg): seg is CaptureSpecSeg {
  return (seg as CaptureSpecSeg).cap !== undefined;
}

/**
 * extractCapture parses specJson and returns the raw substring of the requested
 * capture within subject, or "" when the subject does not match the template.
 */
export function extractCapture(subject: string, specJson: string): string {
  let spec: ExtractSpec;
  try {
    spec = JSON.parse(specJson) as ExtractSpec;
  } catch {
    return "";
  }
  const captures: Record<string, string> = {};
  if (!matchSegs(spec.segs, 0, subject, captures)) return "";
  return captures[spec.want] ?? "";
}

function matchSegs(
  segs: readonly SpecSeg[],
  i: number,
  s: string,
  captures: Record<string, string>,
): boolean {
  if (i >= segs.length) return s === "";
  const seg = segs[i];
  if (seg === undefined) return s === "";
  if (!isCapture(seg)) {
    if (!s.startsWith(seg.text)) return false;
    return matchSegs(segs, i + 1, s.slice(seg.text.length), captures);
  }
  const isTerminal = i === segs.length - 1;
  if (isTerminal) {
    if (!captureAccepts(s, seg)) return false;
    captures[seg.cap] = s;
    return true;
  }
  for (let end = 1; end <= s.length; end++) {
    const raw = s.slice(0, end);
    if (!captureAccepts(raw, seg)) continue;
    const trial = { ...captures, [seg.cap]: raw };
    if (matchSegs(segs, i + 1, s.slice(end), trial)) {
      Object.assign(captures, trial);
      return true;
    }
  }
  return false;
}

function captureAccepts(raw: string, seg: CaptureSpecSeg): boolean {
  if (raw === "") return false;
  switch (seg.t) {
    case "str":
      return true;
    case "integer":
      return isCanonicalInteger(raw) && isFiniteFloat64(raw);
    case "number":
      return isCanonicalNumber(raw) && isFiniteFloat64(raw);
    case "bool":
      return raw === "true" || raw === "false";
    case "enum":
      return seg.vals !== undefined && seg.vals.includes(raw);
    default:
      return false;
  }
}

function isCanonicalInteger(s: string): boolean {
  let digits = s;
  let neg = false;
  if (s.startsWith("-")) {
    neg = true;
    digits = s.slice(1);
  }
  if (!isCanonicalDigits(digits)) return false;
  return !(neg && digits === "0");
}

function isCanonicalNumber(s: string): boolean {
  let intPart = s;
  let fracPart = "";
  const dot = s.indexOf(".");
  if (dot >= 0) {
    intPart = s.slice(0, dot);
    fracPart = s.slice(dot + 1);
    if (fracPart === "" || !isDigits(fracPart)) return false;
  }
  let digits = intPart;
  let neg = false;
  if (intPart.startsWith("-")) {
    neg = true;
    digits = intPart.slice(1);
  }
  if (!isCanonicalDigits(digits)) return false;
  return !(neg && digits === "0" && fracPart === "");
}

// Match Go's strconv.ParseFloat(..., 64): reject overflow.
function isFiniteFloat64(s: string): boolean {
  const n = Number(s);
  return Number.isFinite(n);
}

function isCanonicalDigits(s: string): boolean {
  if (s === "0") return true;
  if (s === "" || s.charCodeAt(0) === 48) return false;
  return isDigits(s);
}

function isDigits(s: string): boolean {
  if (s === "") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}
