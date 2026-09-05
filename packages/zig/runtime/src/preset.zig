//! Preset functions: the public surface.
//!
//! Execution lives in `preset/kernel.zig` (pure transformations) and
//! `preset/table.zig` (the comptime dispatch table). This file is the name-based
//! facade the rest of the runtime and the authoring ABI call.
//!
//! The type metadata below answers by name *prefix*, not by table membership. It
//! deliberately reports a type for names the table does not list, because the
//! builder API validates hand-written graphs that use them. Do not reroute it
//! through `table.lookup`.

const std = @import("std");
const kernel = @import("preset/kernel.zig");
const table = @import("preset/table.zig");
const value = @import("value.zig");

pub const PresetError = kernel.Error;

/// What a call can fail with: a preset's own errors plus allocation.
pub const CallError = table.CallError;

pub const Fn = table.Fn;
pub const lookup = table.lookup;
pub const argumentCount = table.argumentCount;

pub fn inputType(name: []const u8) ?[]const u8 {
    if (std.mem.startsWith(u8, name, "transformFnNumber::")) return "number";
    if (std.mem.startsWith(u8, name, "transformFnString::")) return "string";
    if (std.mem.startsWith(u8, name, "transformFnBoolean::")) return "boolean";
    if (std.mem.startsWith(u8, name, "transformFnNull::")) return "null";
    if (std.mem.startsWith(u8, name, "transformFnArray::")) return "array";
    if (std.mem.startsWith(u8, name, "transformFnRecord::")) return "record";
    return null;
}

pub fn parameterType(name: []const u8) ?[]const u8 {
    if (std.mem.startsWith(u8, name, "combineFnNumber::")) return "number";
    if (std.mem.startsWith(u8, name, "combineFnString::")) return "string";
    if (std.mem.startsWith(u8, name, "combineFnBoolean::")) return "boolean";
    return null;
}

/// How many arguments a combine function consumes. Arguments are named "a",
/// "b", and "c" in order, so an arity of n means the first n of those names
/// carry a binding and a transform chain.
pub fn arity(name: []const u8) usize {
    if (std.mem.eql(u8, name, "combineFnRecord::set")) return 3;
    return 2;
}

pub fn passTransform(type_symbol: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, type_symbol, "number")) return "transformFnNumber::pass";
    if (std.mem.eql(u8, type_symbol, "string")) return "transformFnString::pass";
    if (std.mem.eql(u8, type_symbol, "boolean")) return "transformFnBoolean::pass";
    if (std.mem.eql(u8, type_symbol, "null")) return "transformFnNull::pass";
    if (std.mem.eql(u8, type_symbol, "array")) return "transformFnArray::pass";
    if (std.mem.eql(u8, type_symbol, "record")) return "transformFnRecord::pass";
    return null;
}

pub fn returnType(name: []const u8, array_element: ?[]const u8) ?[]const u8 {
    if (std.mem.endsWith(u8, name, "::pass")) return inputType(name);
    if (std.mem.eql(u8, name, "transformFnNumber::toStr") or
        std.mem.eql(u8, name, "transformFnBoolean::toStr")) return "string";
    if (std.mem.startsWith(u8, name, "transformFnNumber::")) return "number";
    if (std.mem.eql(u8, name, "transformFnString::length")) return "number";
    if (std.mem.eql(u8, name, "transformFnString::toNumber")) return "number";
    if (std.mem.startsWith(u8, name, "transformFnString::")) return "string";
    if (std.mem.eql(u8, name, "transformFnBoolean::not")) return "boolean";
    if (std.mem.eql(u8, name, "transformFnArray::length")) return "number";
    if (std.mem.eql(u8, name, "transformFnArray::isEmpty")) return "boolean";
    if (std.mem.startsWith(u8, name, "combineFnNumber::greaterThan") or
        std.mem.startsWith(u8, name, "combineFnNumber::lessThan")) return "boolean";
    if (std.mem.startsWith(u8, name, "combineFnNumber::")) return "number";
    if (std.mem.eql(u8, name, "combineFnString::includes") or
        std.mem.eql(u8, name, "combineFnString::startsWith") or
        std.mem.eql(u8, name, "combineFnString::endsWith")) return "boolean";
    if (std.mem.eql(u8, name, "combineFnString::extractNum")) return "number";
    if (std.mem.startsWith(u8, name, "combineFnString::")) return "string";
    if (std.mem.startsWith(u8, name, "combineFnBoolean::") or
        std.mem.startsWith(u8, name, "combineFnGeneric::")) return "boolean";
    if (std.mem.eql(u8, name, "combineFnArray::includes")) return "boolean";
    if (std.mem.eql(u8, name, "combineFnArray::concat")) return "array";
    if (std.mem.eql(u8, name, "combineFnArray::get")) return array_element;
    if (std.mem.startsWith(u8, name, "combineFnArray::get"))
        return typedGetterReturn(name["combineFnArray::get".len..]);
    if (std.mem.eql(u8, name, "combineFnRecord::set")) return "record";
    if (std.mem.startsWith(u8, name, "combineFnRecord::get"))
        return typedGetterReturn(name["combineFnRecord::get".len..]);
    return null;
}

fn typedGetterReturn(suffix: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, suffix, "Number")) return "number";
    if (std.mem.eql(u8, suffix, "String")) return "string";
    if (std.mem.eql(u8, suffix, "Boolean")) return "boolean";
    if (std.mem.eql(u8, suffix, "Array")) return "array";
    if (std.mem.eql(u8, suffix, "Record")) return "record";
    return null;
}

/// Resolves a preset by name and calls it.
///
/// Unknown names are `error.UnknownFunction` and a known name with the wrong
/// number of arguments is `error.InvalidArity`, which callers rely on to probe
/// whether a name exists.
pub fn call(
    name: []const u8,
    args: []const value.TaggedValue,
    allocator: std.mem.Allocator,
) CallError!value.OwnedTaggedValue {
    const function = table.lookup(name) orelse return error.UnknownFunction;
    return table.call(function, args, allocator);
}

/// Calls a preset already resolved to its enum. This is the path the loader uses
/// once a program has been lowered; it costs a jump-table dispatch and no string
/// comparison at all.
pub fn callFn(
    function: Fn,
    args: []const value.TaggedValue,
    allocator: std.mem.Allocator,
) CallError!value.OwnedTaggedValue {
    return table.call(function, args, allocator);
}

// ── re-exports kept for callers and tests that use them directly ────────────

pub const extractCapture = kernelExtractCapture;

fn kernelExtractCapture(subject: []const u8, spec_json: []const u8, allocator: std.mem.Allocator) ![]const u8 {
    return kernel.extractCapture(allocator, subject, spec_json);
}

pub const divide = kernel.divide;
pub const modulo = kernel.modulo;
pub const jsRound = kernel.round;

pub fn jsStringLength(bytes: []const u8) PresetError!usize {
    return @intFromFloat(try kernel.strLength(bytes));
}

pub const jsTrim = kernel.strTrim;

test "preset signature metadata matches public Value symbols" {
    try std.testing.expectEqualStrings("number", inputType("transformFnNumber::abs").?);
    try std.testing.expectEqualStrings("string", returnType("transformFnNumber::toStr", null).?);
    try std.testing.expectEqualStrings("number", parameterType("combineFnNumber::add").?);
    try std.testing.expectEqualStrings("record", returnType("combineFnArray::get", "record").?);
    try std.testing.expect(returnType("combineFnRecord::missing", null) == null);
    try std.testing.expectEqualStrings("transformFnNumber::pass", passTransform("number").?);
    try std.testing.expectEqualStrings("transformFnString::pass", passTransform("string").?);
    try std.testing.expectEqualStrings("transformFnBoolean::pass", passTransform("boolean").?);
    try std.testing.expectEqualStrings("transformFnNull::pass", passTransform("null").?);
    try std.testing.expectEqualStrings("transformFnArray::pass", passTransform("array").?);
    try std.testing.expectEqualStrings("transformFnRecord::pass", passTransform("record").?);
    try std.testing.expect(passTransform("unknown") == null);
    try std.testing.expectEqual(@as(usize, 3), arity("combineFnRecord::set"));
    try std.testing.expectEqual(@as(usize, 2), arity("combineFnNumber::add"));
    try std.testing.expectEqual(@as(usize, 2), arity("combineFnRecord::getNumber"));
}
test "numeric, boolean, string, and generic calls propagate tags" {
    const allocator = std.testing.allocator;
    const left: value.TaggedValue = .{ .value = .{ .number = 10 }, .tags = &.{"left"} };
    const right: value.TaggedValue = .{ .value = .{ .number = 3 }, .tags = &.{"right"} };
    var sum = try call("combineFnNumber::add", &.{ left, right }, allocator);
    defer sum.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 13), sum.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{ "left", "right" }, sum.tags);

    const null_a: value.TaggedValue = .{ .value = .{ .null_value = .missing } };
    const null_b: value.TaggedValue = .{ .value = .{ .null_value = .redacted } };
    var equal = try call("combineFnGeneric::isEqual", &.{ null_a, null_b }, allocator);
    defer equal.deinit(allocator);
    try std.testing.expect(equal.value.boolean);
}

test "tagged array and record operations preserve child provenance" {
    const allocator = std.testing.allocator;
    var items = [_]value.TaggedValue{.{ .value = .{ .number = 2 }, .tags = &.{"item"} }};
    const array: value.TaggedValue = .{ .value = .{ .array = .{ .items = &items } }, .tags = &.{"array"} };
    const index: value.TaggedValue = .{ .value = .{ .number = 0 }, .tags = &.{"index"} };
    var got = try call("combineFnArray::getNumber", &.{ array, index }, allocator);
    defer got.deinit(allocator);
    try std.testing.expectEqualSlices([]const u8, &.{ "item", "array", "index" }, got.tags);

    var fields: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    try fields.put(allocator, "score", .{ .value = .{ .number = 4 }, .tags = &.{"field"} });
    defer fields.deinit(allocator);
    const record: value.TaggedValue = .{ .value = .{ .record = fields }, .tags = &.{"record"} };
    const key: value.TaggedValue = .{ .value = .{ .string = "score" }, .tags = &.{"key"} };
    var record_got = try call("combineFnRecord::getNumber", &.{ record, key }, allocator);
    defer record_got.deinit(allocator);
    try std.testing.expectEqualSlices([]const u8, &.{ "field", "record", "key" }, record_got.tags);
}

test "template extraction matches canonical typed captures" {
    const allocator = std.testing.allocator;
    const spec =
        \\{"want":"sequence","segs":[{"cap":"kind","t":"enum","vals":["foo","bar"]},{"text":"-"},{"cap":"sequence","t":"integer"}]}
    ;
    try std.testing.expectEqualStrings("42", try extractCapture("foo-42", spec, allocator));
    try std.testing.expectEqualStrings("", try extractCapture("baz-42", spec, allocator));
    try std.testing.expectEqualStrings("", try extractCapture("foo-01", spec, allocator));
    try std.testing.expectError(error.InvalidTemplateSpec, extractCapture("foo-42", "{bad", allocator));

    const subject: value.TaggedValue = .{ .value = .{ .string = "foo-42" }, .tags = &.{"subject"} };
    const descriptor: value.TaggedValue = .{ .value = .{ .string = spec }, .tags = &.{"descriptor"} };
    var extracted = try call("combineFnString::extract", &.{ subject, descriptor }, allocator);
    defer extracted.deinit(allocator);
    try std.testing.expectEqualStrings("42", extracted.value.string);
    try std.testing.expectEqualSlices([]const u8, &.{ "subject", "descriptor" }, extracted.tags);
    var number = try call("combineFnString::extractNum", &.{ subject, descriptor }, allocator);
    defer number.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 42), number.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{"subject"}, number.tags);
}

test "division, rounding, and UTF-16 length match JavaScript edges" {
    try std.testing.expectError(error.DivisionByZero, divide(1, -0.0));
    try std.testing.expectEqual(@as(f64, -2), jsRound(-2.5));
    try std.testing.expect(std.math.signbit(jsRound(-0.1)));
    try std.testing.expectEqual(@as(usize, 2), try jsStringLength("😀"));
    try std.testing.expectEqualStrings("hello", try jsTrim("\xEF\xBB\xBF\xE3\x80\x80hello\xC2\xA0"));
}

test "string and boolean transforms preserve JavaScript values and tags" {
    const allocator = std.testing.allocator;
    const text: value.TaggedValue = .{ .value = .{ .string = "\xE3\x80\x80😀 ok\xC2\xA0" }, .tags = &.{"text"} };
    var trimmed = try call("transformFnString::trim", &.{text}, allocator);
    defer trimmed.deinit(allocator);
    try std.testing.expectEqualStrings("😀 ok", trimmed.value.string);
    try std.testing.expectEqualSlices([]const u8, &.{"text"}, trimmed.tags);

    const emoji: value.TaggedValue = .{ .value = .{ .string = "😀" }, .tags = &.{"emoji"} };
    var length = try call("transformFnString::length", &.{emoji}, allocator);
    defer length.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 2), length.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{"emoji"}, length.tags);

    const boolean: value.TaggedValue = .{ .value = .{ .boolean = false }, .tags = &.{"boolean"} };
    var string = try call("transformFnBoolean::toStr", &.{boolean}, allocator);
    defer string.deinit(allocator);
    try std.testing.expectEqualStrings("false", string.value.string);
    try std.testing.expectEqualSlices([]const u8, &.{"boolean"}, string.tags);
}

test "string to number is strict and finite" {
    const allocator = std.testing.allocator;
    const valid: value.TaggedValue = .{ .value = .{ .string = "\xE3\x80\x80-1.25e2\xC2\xA0" }, .tags = &.{"input"} };
    var number = try call("transformFnString::toNumber", &.{valid}, allocator);
    defer number.deinit(allocator);
    try std.testing.expectEqual(@as(f64, -125), number.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{"input"}, number.tags);

    const malformed: value.TaggedValue = .{ .value = .{ .string = "42abc" } };
    const empty: value.TaggedValue = .{ .value = .{ .string = "  " } };
    const infinite: value.TaggedValue = .{ .value = .{ .string = "Infinity" } };
    try std.testing.expectError(error.InvalidNumber, call("transformFnString::toNumber", &.{malformed}, allocator));
    try std.testing.expectError(error.InvalidNumber, call("transformFnString::toNumber", &.{empty}, allocator));
    try std.testing.expectError(error.InvalidNumber, call("transformFnString::toNumber", &.{infinite}, allocator));
}

test "number to string uses JavaScript notation boundaries" {
    const allocator = std.testing.allocator;
    const cases = [_]struct { number: f64, expected: []const u8 }{
        .{ .number = -0.0, .expected = "0" },
        .{ .number = 1e21, .expected = "1e+21" },
        .{ .number = 1e20, .expected = "100000000000000000000" },
        .{ .number = 1e-6, .expected = "0.000001" },
        .{ .number = 1e-7, .expected = "1e-7" },
        .{ .number = std.math.inf(f64), .expected = "Infinity" },
    };
    for (cases) |case| {
        const input: value.TaggedValue = .{ .value = .{ .number = case.number }, .tags = &.{"number"} };
        var string = try call("transformFnNumber::toStr", &.{input}, allocator);
        defer string.deinit(allocator);
        try std.testing.expectEqualStrings(case.expected, string.value.string);
        try std.testing.expectEqualSlices([]const u8, &.{"number"}, string.tags);
    }
}

test "Unicode case conversion matches ECMAScript expansions and final sigma" {
    const allocator = std.testing.allocator;
    const upper_input: value.TaggedValue = .{ .value = .{ .string = "Straße" }, .tags = &.{"text"} };
    var upper = try call("transformFnString::toUpperCase", &.{upper_input}, allocator);
    defer upper.deinit(allocator);
    try std.testing.expectEqualStrings("STRASSE", upper.value.string);
    try std.testing.expectEqualSlices([]const u8, &.{"text"}, upper.tags);

    const dotted: value.TaggedValue = .{ .value = .{ .string = "İ" } };
    var lower = try call("transformFnString::toLowerCase", &.{dotted}, allocator);
    defer lower.deinit(allocator);
    try std.testing.expectEqualStrings("i\xCC\x87", lower.value.string);

    const greek: value.TaggedValue = .{ .value = .{ .string = "ΟΣ ΟΣΑ" } };
    var greek_lower = try call("transformFnString::toLowerCase", &.{greek}, allocator);
    defer greek_lower.deinit(allocator);
    try std.testing.expectEqualStrings("ος οσα", greek_lower.value.string);
}

test "every alias in the shared specification resolves to a table entry" {
    // Guards the seam between spec/fn-aliases.json and the dispatch table: an
    // alias that names a preset the table does not list would otherwise only
    // fail when a model happened to use it.
    const fn_aliases = @import("generated/fn_aliases.zig");
    for (fn_aliases.aliases) |alias| {
        const resolved = table.lookup(alias.runtime) orelse {
            std.debug.print("alias {s} names unknown preset {s}\n", .{ alias.hcl, alias.runtime });
            return error.UnknownPreset;
        };
        try std.testing.expectEqualStrings(alias.runtime, @tagName(resolved));
    }
}

test "dispatch resolves by name and by enum to the same result" {
    const allocator = std.testing.allocator;
    const args = [_]value.TaggedValue{
        .{ .value = .{ .number = 7 } },
        .{ .value = .{ .number = 5 } },
    };
    var by_name = try call("combineFnNumber::minus", &args, allocator);
    defer by_name.deinit(allocator);
    var by_enum = try callFn(lookup("combineFnNumber::minus").?, &args, allocator);
    defer by_enum.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 2), by_name.value.number);
    try std.testing.expect(by_name.value.eql(by_enum.value));

    try std.testing.expectError(error.UnknownFunction, call("combineFnNumber::nope", &args, allocator));
    try std.testing.expectError(error.InvalidArity, call("transformFnNumber::abs", &args, allocator));
}

test "argument counts come from the kernel signatures" {
    try std.testing.expectEqual(@as(usize, 3), argumentCount(lookup("combineFnRecord::set").?));
    try std.testing.expectEqual(@as(usize, 2), argumentCount(lookup("combineFnNumber::add").?));
    try std.testing.expectEqual(@as(usize, 1), argumentCount(lookup("transformFnNumber::abs").?));
}
