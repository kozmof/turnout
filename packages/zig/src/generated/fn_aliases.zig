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

pub fn resolve(name: []const u8) ?[]const u8 {
    for (aliases) |alias| {
        if (std.mem.eql(u8, alias.hcl, name)) return alias.runtime;
    }
    return null;
}

test "aliases resolve from the shared specification" {
    try std.testing.expectEqualStrings("combineFnNumber::add", resolve("add").?);
    try std.testing.expectEqualStrings("combineFnRecord::set", resolve("record_set").?);
    try std.testing.expect(resolve("unknown") == null);
}
