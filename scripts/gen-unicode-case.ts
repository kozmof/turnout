import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Mapping = { source: number; replacement: string };
type Range = { first: number; last: number };
type CaseMap = {
  unicodeVersion: string;
  lower: Mapping[];
  upper: Mapping[];
  cased: Range[];
  caseIgnorable: Range[];
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = resolve(root, "spec/unicode-case-map.json");

if (process.argv.includes("--refresh-spec")) {
  const lower: Mapping[] = [];
  const upper: Mapping[] = [];
  const cased: Range[] = [];
  const caseIgnorable: Range[] = [];
  const appendRange = (ranges: Range[], source: number): void => {
    const last = ranges.at(-1);
    if (last !== undefined && last.last + 1 === source) last.last = source;
    else ranges.push({ first: source, last: source });
  };
  for (let source = 0; source <= 0x10ffff; source += 1) {
    if (source >= 0xd800 && source <= 0xdfff) continue;
    const scalar = String.fromCodePoint(source);
    const lowerReplacement = scalar.toLowerCase();
    const upperReplacement = scalar.toUpperCase();
    if (lowerReplacement !== scalar) lower.push({ source, replacement: lowerReplacement });
    if (upperReplacement !== scalar) upper.push({ source, replacement: upperReplacement });
    if (/\p{Cased}/u.test(scalar)) appendRange(cased, source);
    if (/\p{Case_Ignorable}/u.test(scalar)) appendRange(caseIgnorable, source);
  }
  const spec: CaseMap = {
    unicodeVersion: process.versions.unicode,
    lower,
    upper,
    cased,
    caseIgnorable,
  };
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");
  console.log(`Refreshed ${specPath} from Unicode ${spec.unicodeVersion}`);
}

const spec = JSON.parse(readFileSync(specPath, "utf8")) as CaseMap;
const zigBytes = (text: string): string =>
  `"${[...Buffer.from(text, "utf8")].map((byte) => `\\x${byte.toString(16).padStart(2, "0")}`).join("")}"`;
const rows = (mappings: Mapping[]): string[] =>
  mappings.map(
    ({ source, replacement }) =>
      `    .{ .source = 0x${source.toString(16)}, .replacement = ${zigBytes(replacement)} },`,
  );
const rangeRows = (ranges: Range[]): string[] =>
  ranges.map(
    ({ first, last }) =>
      `    .{ .first = 0x${first.toString(16)}, .last = 0x${last.toString(16)} },`,
  );
const output = [
  "// AUTO-GENERATED. DO NOT EDIT.",
  "// Source of truth: spec/unicode-case-map.json",
  "// Regenerate: node --experimental-strip-types scripts/gen-unicode-case.ts",
  `pub const unicode_version = "${spec.unicodeVersion}";`,
  "pub const Mapping = struct { source: u21, replacement: []const u8 };",
  "pub const Range = struct { first: u21, last: u21 };",
  "pub const lower = [_]Mapping{",
  ...rows(spec.lower),
  "};",
  "pub const upper = [_]Mapping{",
  ...rows(spec.upper),
  "};",
  "pub const cased = [_]Range{",
  ...rangeRows(spec.cased),
  "};",
  "pub const case_ignorable = [_]Range{",
  ...rangeRows(spec.caseIgnorable),
  "};",
  "",
].join("\n");
const destination = resolve(root, "packages/zig/src/generated/unicode_case.zig");
writeFileSync(destination, output);
console.log(`Generated ${destination} from Unicode ${spec.unicodeVersion}`);
