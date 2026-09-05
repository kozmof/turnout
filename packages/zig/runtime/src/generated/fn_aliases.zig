// AUTO-GENERATED. DO NOT EDIT.
// Source of truth: spec/fn-aliases.json
// Regenerate: node --experimental-strip-types scripts/gen-fn-map.ts
const std = @import("std");

pub const Alias = struct { hcl: []const u8, runtime: []const u8 };

pub const aliases = [_]Alias{
    .{ .hcl = "add", .runtime = "combineFnNumber::add" },
    .{ .hcl = "sub", .runtime = "combineFnNumber::minus" },
    .{ .hcl = "mul", .runtime = "combineFnNumber::multiply" },
    .{ .hcl = "div", .runtime = "combineFnNumber::divide" },
    .{ .hcl = "mod", .runtime = "combineFnNumber::mod" },
    .{ .hcl = "max", .runtime = "combineFnNumber::max" },
    .{ .hcl = "min", .runtime = "combineFnNumber::min" },
    .{ .hcl = "gt", .runtime = "combineFnNumber::greaterThan" },
    .{ .hcl = "gte", .runtime = "combineFnNumber::greaterThanOrEqual" },
    .{ .hcl = "lt", .runtime = "combineFnNumber::lessThan" },
    .{ .hcl = "lte", .runtime = "combineFnNumber::lessThanOrEqual" },
    .{ .hcl = "bool_and", .runtime = "combineFnBoolean::and" },
    .{ .hcl = "bool_or", .runtime = "combineFnBoolean::or" },
    .{ .hcl = "bool_xor", .runtime = "combineFnBoolean::xor" },
    .{ .hcl = "str_concat", .runtime = "combineFnString::concat" },
    .{ .hcl = "str_includes", .runtime = "combineFnString::includes" },
    .{ .hcl = "str_starts", .runtime = "combineFnString::startsWith" },
    .{ .hcl = "str_ends", .runtime = "combineFnString::endsWith" },
    .{ .hcl = "template_extract", .runtime = "combineFnString::extract" },
    .{ .hcl = "template_extract_num", .runtime = "combineFnString::extractNum" },
    .{ .hcl = "eq", .runtime = "combineFnGeneric::isEqual" },
    .{ .hcl = "neq", .runtime = "combineFnGeneric::isNotEqual" },
    .{ .hcl = "arr_concat", .runtime = "combineFnArray::concat" },
    .{ .hcl = "arr_get", .runtime = "combineFnArray::getNumber" },
    .{ .hcl = "arr_get_number", .runtime = "combineFnArray::getNumber" },
    .{ .hcl = "arr_get_str", .runtime = "combineFnArray::getString" },
    .{ .hcl = "arr_get_bool", .runtime = "combineFnArray::getBoolean" },
    .{ .hcl = "arr_get_array", .runtime = "combineFnArray::getArray" },
    .{ .hcl = "arr_get_record", .runtime = "combineFnArray::getRecord" },
    .{ .hcl = "arr_includes", .runtime = "combineFnArray::includes" },
    .{ .hcl = "record_get", .runtime = "combineFnRecord::getNumber" },
    .{ .hcl = "record_get_number", .runtime = "combineFnRecord::getNumber" },
    .{ .hcl = "record_get_str", .runtime = "combineFnRecord::getString" },
    .{ .hcl = "record_get_bool", .runtime = "combineFnRecord::getBoolean" },
    .{ .hcl = "record_get_array", .runtime = "combineFnRecord::getArray" },
    .{ .hcl = "record_get_record", .runtime = "combineFnRecord::getRecord" },
    .{ .hcl = "record_set", .runtime = "combineFnRecord::set" },
};

/// Comptime perfect hash over the same table. Alias resolution happens once
/// per program load, so this never runs on the execution path.
const by_hcl = std.StaticStringMap([]const u8).initComptime(.{
    .{ "add", "combineFnNumber::add" },
    .{ "sub", "combineFnNumber::minus" },
    .{ "mul", "combineFnNumber::multiply" },
    .{ "div", "combineFnNumber::divide" },
    .{ "mod", "combineFnNumber::mod" },
    .{ "max", "combineFnNumber::max" },
    .{ "min", "combineFnNumber::min" },
    .{ "gt", "combineFnNumber::greaterThan" },
    .{ "gte", "combineFnNumber::greaterThanOrEqual" },
    .{ "lt", "combineFnNumber::lessThan" },
    .{ "lte", "combineFnNumber::lessThanOrEqual" },
    .{ "bool_and", "combineFnBoolean::and" },
    .{ "bool_or", "combineFnBoolean::or" },
    .{ "bool_xor", "combineFnBoolean::xor" },
    .{ "str_concat", "combineFnString::concat" },
    .{ "str_includes", "combineFnString::includes" },
    .{ "str_starts", "combineFnString::startsWith" },
    .{ "str_ends", "combineFnString::endsWith" },
    .{ "template_extract", "combineFnString::extract" },
    .{ "template_extract_num", "combineFnString::extractNum" },
    .{ "eq", "combineFnGeneric::isEqual" },
    .{ "neq", "combineFnGeneric::isNotEqual" },
    .{ "arr_concat", "combineFnArray::concat" },
    .{ "arr_get", "combineFnArray::getNumber" },
    .{ "arr_get_number", "combineFnArray::getNumber" },
    .{ "arr_get_str", "combineFnArray::getString" },
    .{ "arr_get_bool", "combineFnArray::getBoolean" },
    .{ "arr_get_array", "combineFnArray::getArray" },
    .{ "arr_get_record", "combineFnArray::getRecord" },
    .{ "arr_includes", "combineFnArray::includes" },
    .{ "record_get", "combineFnRecord::getNumber" },
    .{ "record_get_number", "combineFnRecord::getNumber" },
    .{ "record_get_str", "combineFnRecord::getString" },
    .{ "record_get_bool", "combineFnRecord::getBoolean" },
    .{ "record_get_array", "combineFnRecord::getArray" },
    .{ "record_get_record", "combineFnRecord::getRecord" },
    .{ "record_set", "combineFnRecord::set" },
});

pub fn resolve(name: []const u8) ?[]const u8 {
    return by_hcl.get(name);
}

test "aliases resolve from the shared specification" {
    try std.testing.expectEqualStrings("combineFnNumber::add", resolve("add").?);
    try std.testing.expectEqualStrings("combineFnRecord::set", resolve("record_set").?);
    try std.testing.expect(resolve("unknown") == null);
}
