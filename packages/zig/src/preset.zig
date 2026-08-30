const std = @import("std");
const value = @import("value.zig");

pub const PresetError = error{
    DivisionByZero,
    ModuloByZero,
    InvalidUtf8,
    UnknownFunction,
    InvalidArity,
    TypeMismatch,
    IndexOutOfBounds,
    IncomparableValues,
};

pub fn call(
    name: []const u8,
    args: []const value.TaggedValue,
    allocator: std.mem.Allocator,
) (PresetError || std.mem.Allocator.Error)!value.OwnedTaggedValue {
    if (std.mem.eql(u8, name, "combineFnNumber::add")) return numberBinary(args, allocator, .add);
    if (std.mem.eql(u8, name, "combineFnNumber::minus")) return numberBinary(args, allocator, .minus);
    if (std.mem.eql(u8, name, "combineFnNumber::multiply")) return numberBinary(args, allocator, .multiply);
    if (std.mem.eql(u8, name, "combineFnNumber::divide")) return numberBinary(args, allocator, .divide);
    if (std.mem.eql(u8, name, "combineFnNumber::mod")) return numberBinary(args, allocator, .modulo);
    if (std.mem.eql(u8, name, "combineFnNumber::max")) return numberBinary(args, allocator, .maximum);
    if (std.mem.eql(u8, name, "combineFnNumber::min")) return numberBinary(args, allocator, .minimum);
    if (std.mem.eql(u8, name, "combineFnNumber::greaterThan")) return numberCompare(args, allocator, .gt);
    if (std.mem.eql(u8, name, "combineFnNumber::greaterThanOrEqual")) return numberCompare(args, allocator, .gte);
    if (std.mem.eql(u8, name, "combineFnNumber::lessThan")) return numberCompare(args, allocator, .lt);
    if (std.mem.eql(u8, name, "combineFnNumber::lessThanOrEqual")) return numberCompare(args, allocator, .lte);
    if (std.mem.eql(u8, name, "combineFnBoolean::and")) return booleanBinary(args, allocator, .and_op);
    if (std.mem.eql(u8, name, "combineFnBoolean::or")) return booleanBinary(args, allocator, .or_op);
    if (std.mem.eql(u8, name, "combineFnBoolean::xor")) return booleanBinary(args, allocator, .xor);
    if (std.mem.eql(u8, name, "combineFnGeneric::isEqual")) return genericEquality(args, allocator, false);
    if (std.mem.eql(u8, name, "combineFnGeneric::isNotEqual")) return genericEquality(args, allocator, true);
    if (std.mem.eql(u8, name, "combineFnString::concat")) return stringConcat(args, allocator);
    if (std.mem.eql(u8, name, "combineFnString::includes")) return stringPredicate(args, allocator, .includes);
    if (std.mem.eql(u8, name, "combineFnString::startsWith")) return stringPredicate(args, allocator, .starts_with);
    if (std.mem.eql(u8, name, "combineFnString::endsWith")) return stringPredicate(args, allocator, .ends_with);
    if (std.mem.eql(u8, name, "combineFnArray::concat")) return arrayConcat(args, allocator);
    if (std.mem.eql(u8, name, "combineFnArray::includes")) return arrayIncludes(args, allocator);
    if (std.mem.startsWith(u8, name, "combineFnArray::get")) return arrayGet(args, allocator);
    if (std.mem.startsWith(u8, name, "combineFnRecord::get")) return recordGet(args, allocator);
    if (std.mem.eql(u8, name, "combineFnRecord::set")) return recordSet(args, allocator);
    if (std.mem.eql(u8, name, "transformFnNumber::abs")) return numberUnary(args, allocator, .absolute);
    if (std.mem.eql(u8, name, "transformFnNumber::floor")) return numberUnary(args, allocator, .floor);
    if (std.mem.eql(u8, name, "transformFnNumber::ceil")) return numberUnary(args, allocator, .ceil);
    if (std.mem.eql(u8, name, "transformFnNumber::round")) return numberUnary(args, allocator, .round);
    if (std.mem.eql(u8, name, "transformFnNumber::negate")) return numberUnary(args, allocator, .negate);
    if (std.mem.eql(u8, name, "transformFnBoolean::not")) return booleanNot(args, allocator);
    if (std.mem.eql(u8, name, "transformFnArray::length")) return arrayLength(args, allocator, false);
    if (std.mem.eql(u8, name, "transformFnArray::isEmpty")) return arrayLength(args, allocator, true);
    if (std.mem.endsWith(u8, name, "::pass")) return pass(args, allocator);
    return error.UnknownFunction;
}

const NumberBinary = enum { add, minus, multiply, divide, modulo, maximum, minimum };
const NumberCompare = enum { gt, gte, lt, lte };
const NumberUnary = enum { absolute, floor, ceil, round, negate };
const BooleanBinary = enum { and_op, or_op, xor };
const StringPredicate = enum { includes, starts_with, ends_with };

fn requireArity(args: []const value.TaggedValue, count: usize) PresetError!void {
    if (args.len != count) return error.InvalidArity;
}

fn mergedArgs(args: []const value.TaggedValue, allocator: std.mem.Allocator) ![]const []const u8 {
    var tags: []const []const u8 = try allocator.alloc([]const u8, 0);
    errdefer allocator.free(tags);
    for (args) |arg| {
        const next = try value.mergeTags(tags, arg.tags, allocator);
        allocator.free(tags);
        tags = next;
    }
    return tags;
}

fn numberBinary(args: []const value.TaggedValue, allocator: std.mem.Allocator, operation: NumberBinary) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .number or args[1].value != .number) return error.TypeMismatch;
    const a = args[0].value.number;
    const b = args[1].value.number;
    const result = switch (operation) {
        .add => a + b,
        .minus => a - b,
        .multiply => a * b,
        .divide => try divide(a, b),
        .modulo => try modulo(a, b),
        .maximum => @max(a, b),
        .minimum => @min(a, b),
    };
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildNumber(result, tags, allocator);
}

fn numberCompare(args: []const value.TaggedValue, allocator: std.mem.Allocator, operation: NumberCompare) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .number or args[1].value != .number) return error.TypeMismatch;
    const a = args[0].value.number;
    const b = args[1].value.number;
    const result = switch (operation) {
        .gt => a > b,
        .gte => a >= b,
        .lt => a < b,
        .lte => a <= b,
    };
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildBoolean(result, tags, allocator);
}

fn numberUnary(args: []const value.TaggedValue, allocator: std.mem.Allocator, operation: NumberUnary) !value.OwnedTaggedValue {
    try requireArity(args, 1);
    if (args[0].value != .number) return error.TypeMismatch;
    const input = args[0].value.number;
    const result = switch (operation) {
        .absolute => @abs(input),
        .floor => @floor(input),
        .ceil => @ceil(input),
        .round => jsRound(input),
        .negate => -input,
    };
    return value.buildNumber(result, args[0].tags, allocator);
}

fn booleanBinary(args: []const value.TaggedValue, allocator: std.mem.Allocator, operation: BooleanBinary) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .boolean or args[1].value != .boolean) return error.TypeMismatch;
    const a = args[0].value.boolean;
    const b = args[1].value.boolean;
    const result = switch (operation) {
        .and_op => a and b,
        .or_op => a or b,
        .xor => a != b,
    };
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildBoolean(result, tags, allocator);
}

fn booleanNot(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 1);
    if (args[0].value != .boolean) return error.TypeMismatch;
    return value.buildBoolean(!args[0].value.boolean, args[0].tags, allocator);
}

fn genericEquality(args: []const value.TaggedValue, allocator: std.mem.Allocator, negate: bool) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    const comparable = switch (args[0].value) {
        .number => args[1].value == .number,
        .string => args[1].value == .string,
        .boolean => args[1].value == .boolean,
        .null_value => args[1].value == .null_value,
        .array => args[1].value == .array,
        .record => false,
    };
    if (!comparable) return error.IncomparableValues;
    const result = args[0].value.eql(args[1].value) != negate;
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildBoolean(result, tags, allocator);
}

fn stringConcat(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .string or args[1].value != .string) return error.TypeMismatch;
    const joined = try std.mem.concat(allocator, u8, &.{ args[0].value.string, args[1].value.string });
    defer allocator.free(joined);
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildString(joined, tags, allocator);
}

fn stringPredicate(args: []const value.TaggedValue, allocator: std.mem.Allocator, predicate: StringPredicate) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .string or args[1].value != .string) return error.TypeMismatch;
    const a = args[0].value.string;
    const b = args[1].value.string;
    const result = switch (predicate) {
        .includes => std.mem.indexOf(u8, a, b) != null,
        .starts_with => std.mem.startsWith(u8, a, b),
        .ends_with => std.mem.endsWith(u8, a, b),
    };
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildBoolean(result, tags, allocator);
}

fn arrayConcat(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .array or args[1].value != .array) return error.TypeMismatch;
    const left = args[0].value.array.items;
    const right = args[1].value.array.items;
    const shallow = try allocator.alloc(value.TaggedValue, left.len + right.len);
    defer allocator.free(shallow);
    @memcpy(shallow[0..left.len], left);
    @memcpy(shallow[left.len..], right);
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.build(.{ .array = .{ .items = shallow } }, tags, allocator);
}

fn arrayIncludes(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .array or args[1].value == .array or args[1].value == .record) return error.TypeMismatch;
    var found = false;
    for (args[0].value.array.items) |item| {
        if (item.value.eql(args[1].value)) {
            found = true;
            break;
        }
    }
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    return value.buildBoolean(found, tags, allocator);
}

fn arrayGet(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .array or args[1].value != .number) return error.TypeMismatch;
    const raw_index = args[1].value.number;
    if (!std.math.isFinite(raw_index) or @floor(raw_index) != raw_index or raw_index < 0) return error.IndexOutOfBounds;
    const index: usize = @intFromFloat(raw_index);
    if (index >= args[0].value.array.items.len) return error.IndexOutOfBounds;
    const item = args[0].value.array.items[index];
    const access_tags = try value.mergeTags(args[0].tags, args[1].tags, allocator);
    defer allocator.free(access_tags);
    const tags = try value.mergeTags(item.tags, access_tags, allocator);
    defer allocator.free(tags);
    return value.build(item.value, tags, allocator);
}

fn recordGet(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 2);
    if (args[0].value != .record or (args[1].value != .string and args[1].value != .number)) return error.TypeMismatch;
    const key = try recordKey(args[1].value, allocator);
    defer allocator.free(key);
    const item = args[0].value.record.get(key) orelse return error.IndexOutOfBounds;
    const access_tags = try value.mergeTags(args[0].tags, args[1].tags, allocator);
    defer allocator.free(access_tags);
    const tags = try value.mergeTags(item.tags, access_tags, allocator);
    defer allocator.free(tags);
    return value.build(item.value, tags, allocator);
}

fn recordSet(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 3);
    if (args[0].value != .record or (args[1].value != .string and args[1].value != .number)) return error.TypeMismatch;
    const key = try recordKey(args[1].value, allocator);
    defer allocator.free(key);
    if (std.mem.eql(u8, key, "__proto__") or std.mem.eql(u8, key, "constructor") or std.mem.eql(u8, key, "prototype"))
        return error.TypeMismatch;
    const tags = try mergedArgs(args, allocator);
    defer allocator.free(tags);
    var result = try value.build(args[0].value, tags, allocator);
    errdefer result.deinit(allocator);
    var item = try value.build(args[2].value, args[2].tags, allocator);
    const tagged: value.TaggedValue = .{ .value = item.value, .tags = item.tags };
    item = undefined;
    if (result.value.record.getPtr(key)) |existing| {
        value.deinitTaggedValue(existing, allocator);
        existing.* = tagged;
    } else {
        const owned_key = try allocator.dupe(u8, key);
        result.value.record.put(allocator, owned_key, tagged) catch |err| {
            allocator.free(owned_key);
            var cleanup = tagged;
            value.deinitTaggedValue(&cleanup, allocator);
            return err;
        };
    }
    return result;
}

fn recordKey(key: value.Value, allocator: std.mem.Allocator) ![]u8 {
    return switch (key) {
        .string => |string| allocator.dupe(u8, string),
        .number => |number| std.fmt.allocPrint(allocator, "{d}", .{number}),
        else => error.TypeMismatch,
    };
}

fn arrayLength(args: []const value.TaggedValue, allocator: std.mem.Allocator, empty: bool) !value.OwnedTaggedValue {
    try requireArity(args, 1);
    if (args[0].value != .array) return error.TypeMismatch;
    if (empty) return value.buildBoolean(args[0].value.array.items.len == 0, args[0].tags, allocator);
    return value.buildNumber(@floatFromInt(args[0].value.array.items.len), args[0].tags, allocator);
}

fn pass(args: []const value.TaggedValue, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    try requireArity(args, 1);
    return value.build(args[0].value, args[0].tags, allocator);
}

pub fn divide(a: f64, b: f64) PresetError!f64 {
    if (b == 0) return error.DivisionByZero;
    return a / b;
}

pub fn modulo(a: f64, b: f64) PresetError!f64 {
    if (b == 0) return error.ModuloByZero;
    return @mod(a, b);
}

pub fn jsRound(number: f64) f64 {
    if (std.math.isNan(number) or std.math.isInf(number)) return number;
    if (number < 0 and number >= -0.5) return -0.0;
    return @floor(number + 0.5);
}

pub fn jsStringLength(bytes: []const u8) PresetError!usize {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    var length: usize = 0;
    var index: usize = 0;
    while (index < bytes.len) {
        const sequence_len = std.unicode.utf8ByteSequenceLength(bytes[index]) catch return error.InvalidUtf8;
        const scalar = std.unicode.utf8Decode(bytes[index..][0..sequence_len]) catch return error.InvalidUtf8;
        length += if (scalar > 0xFFFF) 2 else 1;
        index += sequence_len;
    }
    return length;
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

test "division, rounding, and UTF-16 length match JavaScript edges" {
    try std.testing.expectError(error.DivisionByZero, divide(1, -0.0));
    try std.testing.expectEqual(@as(f64, -2), jsRound(-2.5));
    try std.testing.expect(std.math.signbit(jsRound(-0.1)));
    try std.testing.expectEqual(@as(usize, 2), try jsStringLength("😀"));
}
