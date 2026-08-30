const std = @import("std");
const value = @import("value.zig");

const Vector = struct {
    name: []const u8,
    input: std.json.Value,
    tags: []const []const u8,
    expected: std.json.Value,
};

test "shared Value vectors" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(
        []Vector,
        allocator,
        @embedFile("fixtures/value-vectors.json"),
        .{},
    );
    defer parsed.deinit();
    for (parsed.value) |vector| {
        var converted = try value.fromJson(allocator, vector.input);
        defer value.deinitValue(&converted, allocator);
        var tagged = try value.build(converted, vector.tags, allocator);
        defer tagged.deinit(allocator);
        assertCanonical(tagged.borrowed(), vector.expected) catch |err| {
            std.debug.print("shared Value vector failed: {s}\n", .{vector.name});
            return err;
        };
    }
}

fn assertCanonical(actual: value.TaggedValue, expected: std.json.Value) !void {
    if (expected != .object) return error.InvalidVector;
    const symbol = expected.object.get("symbol") orelse return error.InvalidVector;
    const tags = expected.object.get("tags") orelse return error.InvalidVector;
    if (symbol != .string or tags != .array) return error.InvalidVector;
    try std.testing.expectEqual(tags.array.items.len, actual.tags.len);
    for (tags.array.items, actual.tags) |expected_tag, actual_tag| {
        if (expected_tag != .string) return error.InvalidVector;
        try std.testing.expectEqualStrings(expected_tag.string, actual_tag);
    }
    const expected_value = expected.object.get("value") orelse return error.InvalidVector;
    if (std.mem.eql(u8, symbol.string, "number")) {
        try std.testing.expect(actual.value == .number);
        const number: f64 = switch (expected_value) {
            .integer => |integer| @floatFromInt(integer),
            .float => |float| float,
            else => return error.InvalidVector,
        };
        try std.testing.expectEqual(number, actual.value.number);
    } else if (std.mem.eql(u8, symbol.string, "string")) {
        try std.testing.expect(actual.value == .string and expected_value == .string);
        try std.testing.expectEqualStrings(expected_value.string, actual.value.string);
    } else if (std.mem.eql(u8, symbol.string, "boolean")) {
        try std.testing.expect(actual.value == .boolean and expected_value == .bool);
        try std.testing.expectEqual(expected_value.bool, actual.value.boolean);
    } else if (std.mem.eql(u8, symbol.string, "null")) {
        try std.testing.expect(actual.value == .null_value and expected_value == .null);
        try std.testing.expectEqual(value.NullReason.unknown, actual.value.null_value);
    } else if (std.mem.eql(u8, symbol.string, "array")) {
        try std.testing.expect(actual.value == .array and expected_value == .array);
        try std.testing.expectEqual(expected_value.array.items.len, actual.value.array.items.len);
        for (actual.value.array.items, expected_value.array.items) |item, expected_item| try assertCanonical(item, expected_item);
    } else if (std.mem.eql(u8, symbol.string, "record")) {
        try std.testing.expect(actual.value == .record and expected_value == .object);
        try std.testing.expectEqual(expected_value.object.count(), actual.value.record.count());
        var expected_iterator = expected_value.object.iterator();
        var actual_iterator = actual.value.record.iterator();
        while (expected_iterator.next()) |expected_entry| {
            const actual_entry = actual_iterator.next() orelse return error.TestExpectedEqual;
            try std.testing.expectEqualStrings(expected_entry.key_ptr.*, actual_entry.key_ptr.*);
            try assertCanonical(actual_entry.value_ptr.*, expected_entry.value_ptr.*);
        }
    } else return error.InvalidVector;
}
