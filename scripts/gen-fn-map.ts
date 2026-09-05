// Generates the Zig function alias map from spec/fn-aliases.json.
// Run: node --experimental-strip-types scripts/gen-fn-map.ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const aliases = JSON.parse(readFileSync(resolve(root, "spec/fn-aliases.json"), "utf-8")) as Array<{
  hcl: string;
  runtime: string;
}>;

const zigLines = aliases.map(({ hcl, runtime }) => {
  return `    .{ .hcl = "${hcl}", .runtime = "${runtime}" },`;
});
const zigOut = [
  "// AUTO-GENERATED. DO NOT EDIT.",
  "// Source of truth: spec/fn-aliases.json",
  "// Regenerate: node --experimental-strip-types scripts/gen-fn-map.ts",
  'const std = @import("std");',
  "",
  "pub const Alias = struct { hcl: []const u8, runtime: []const u8 };",
  "",
  "pub const aliases = [_]Alias{",
  ...zigLines,
  "};",
  "",
  "pub fn resolve(name: []const u8) ?[]const u8 {",
  "    for (aliases) |alias| {",
  "        if (std.mem.eql(u8, alias.hcl, name)) return alias.runtime;",
  "    }",
  "    return null;",
  "}",
  "",
  'test "aliases resolve from the shared specification" {',
  '    try std.testing.expectEqualStrings("combineFnNumber::add", resolve("add").?);',
  '    try std.testing.expectEqualStrings("combineFnRecord::set", resolve("record_set").?);',
  '    try std.testing.expect(resolve("unknown") == null);',
  "}",
  "",
].join("\n");
const zigDest = resolve(root, "packages/zig/runtime/src/generated/fn_aliases.zig");
writeFileSync(zigDest, zigOut);
console.log(`Generated ${zigDest}`);
