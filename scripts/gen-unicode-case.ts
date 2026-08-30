import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Mapping = { source: number; replacement: string };
type CaseMap = { unicodeVersion: string; lower: Mapping[]; upper: Mapping[] };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = resolve(root, "spec/unicode-case-map.json");

if (process.argv.includes("--refresh-spec")) {
  const lower: Mapping[] = [];
  const upper: Mapping[] = [];
  for (let source = 0; source <= 0x10ffff; source += 1) {
    if (source >= 0xd800 && source <= 0xdfff) continue;
    const scalar = String.fromCodePoint(source);
    const lowerReplacement = scalar.toLowerCase();
    const upperReplacement = scalar.toUpperCase();
    if (lowerReplacement !== scalar) lower.push({ source, replacement: lowerReplacement });
    if (upperReplacement !== scalar) upper.push({ source, replacement: upperReplacement });
  }
  const spec: CaseMap = { unicodeVersion: process.versions.unicode, lower, upper };
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
const output = [
  "// AUTO-GENERATED. DO NOT EDIT.",
  "// Source of truth: spec/unicode-case-map.json",
  "// Regenerate: node --experimental-strip-types scripts/gen-unicode-case.ts",
  `pub const unicode_version = "${spec.unicodeVersion}";`,
  "pub const Mapping = struct { source: u21, replacement: []const u8 };",
  "pub const lower = [_]Mapping{",
  ...rows(spec.lower),
  "};",
  "pub const upper = [_]Mapping{",
  ...rows(spec.upper),
  "};",
  "",
].join("\n");
const destination = resolve(root, "packages/zig/src/generated/unicode_case.zig");
writeFileSync(destination, output);
console.log(`Generated ${destination} from Unicode ${spec.unicodeVersion}`);
