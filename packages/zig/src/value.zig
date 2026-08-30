const std = @import("std");

pub const NullReason = enum { missing, not_found, failure, filtered, redacted, unknown };
pub const ArrayElement = enum { untyped, number, string, boolean, null_value };

pub const Value = union(enum) {
    number: f64,
    string: []const u8,
    boolean: bool,
    null_value: NullReason,
    array: Array,
    record: std.StringArrayHashMapUnmanaged(Value),

    pub const Array = struct { element: ArrayElement = .untyped, items: []Value };

    pub fn eql(a: Value, b: Value) bool {
        if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
        return switch (a) {
            .number => |x| x == b.number,
            .string => |x| std.mem.eql(u8, x, b.string),
            .boolean => |x| x == b.boolean,
            .null_value => |x| x == b.null_value,
            .array => |x| blk: {
                if (x.items.len != b.array.items.len) break :blk false;
                for (x.items, b.array.items) |left, right| if (!left.eql(right)) break :blk false;
                break :blk true;
            },
            .record => |x| blk: {
                if (x.count() != b.record.count()) break :blk false;
                var it = x.iterator();
                while (it.next()) |entry| {
                    const right = b.record.get(entry.key_ptr.*) orelse break :blk false;
                    if (!entry.value_ptr.eql(right)) break :blk false;
                }
                break :blk true;
            },
        };
    }
};

pub const TaggedValue = struct { value: Value, tags: []const []const u8 = &.{} };

/// Convert protobuf JSON Value data into a Turnout Value. Strings borrow from
/// the parsed JSON tree. Arrays and record indexes belong to the caller.
pub fn fromJson(allocator: std.mem.Allocator, json: std.json.Value) !Value {
    return switch (json) {
        .null => .{ .null_value = .unknown },
        .bool => |boolean| .{ .boolean = boolean },
        .integer => |integer| .{ .number = @floatFromInt(integer) },
        .float => |number| if (std.math.isFinite(number))
            .{ .number = number }
        else
            error.NonFiniteNumber,
        .number_string => |number| blk: {
            const parsed = std.fmt.parseFloat(f64, number) catch return error.InvalidNumber;
            if (!std.math.isFinite(parsed)) return error.NonFiniteNumber;
            break :blk .{ .number = parsed };
        },
        .string => |string| .{ .string = string },
        .array => |array| blk: {
            const items = try allocator.alloc(Value, array.items.len);
            errdefer allocator.free(items);
            var initialized: usize = 0;
            errdefer for (items[0..initialized]) |*item| deinit(item, allocator);
            for (array.items, 0..) |item, index| {
                items[index] = try fromJson(allocator, item);
                initialized += 1;
            }
            break :blk .{ .array = .{ .items = items } };
        },
        .object => |object| blk: {
            var record: std.StringArrayHashMapUnmanaged(Value) = .empty;
            errdefer {
                var iterator = record.iterator();
                while (iterator.next()) |entry| deinit(entry.value_ptr, allocator);
                record.deinit(allocator);
            }
            var iterator = object.iterator();
            while (iterator.next()) |entry| {
                try record.put(allocator, entry.key_ptr.*, try fromJson(allocator, entry.value_ptr.*));
            }
            break :blk .{ .record = record };
        },
    };
}

pub fn deinit(self: *Value, allocator: std.mem.Allocator) void {
    switch (self.*) {
        .array => |array| {
            for (array.items) |*item| deinit(item, allocator);
            allocator.free(array.items);
        },
        .record => |*record| {
            var iterator = record.iterator();
            while (iterator.next()) |entry| deinit(entry.value_ptr, allocator);
            record.deinit(allocator);
        },
        else => {},
    }
    self.* = undefined;
}

pub fn add(a: TaggedValue, b: TaggedValue, allocator: std.mem.Allocator) !TaggedValue {
    if (a.value != .number or b.value != .number) return error.TypeMismatch;
    return .{ .value = .{ .number = a.value.number + b.value.number }, .tags = try mergeTags(a.tags, b.tags, allocator) };
}

pub fn mergeTags(a: []const []const u8, b: []const []const u8, allocator: std.mem.Allocator) ![]const []const u8 {
    var result = std.ArrayList([]const u8).empty;
    defer result.deinit(allocator);
    for (a) |tag| try appendUnique(&result, allocator, tag);
    for (b) |tag| try appendUnique(&result, allocator, tag);
    return try result.toOwnedSlice(allocator);
}

fn appendUnique(list: *std.ArrayList([]const u8), allocator: std.mem.Allocator, tag: []const u8) !void {
    for (list.items) |existing| if (std.mem.eql(u8, existing, tag)) return;
    try list.append(allocator, tag);
}

test "structural array equality ignores array element annotation" {
    var items = [_]Value{.{ .number = 1 }};
    const a: Value = .{ .array = .{ .element = .number, .items = &items } };
    const b: Value = .{ .array = .{ .element = .untyped, .items = &items } };
    try std.testing.expect(a.eql(b));
}

test "tags merge in first-seen order" {
    const tags = try mergeTags(&.{ "random", "cached" }, &.{ "cached", "host" }, std.testing.allocator);
    defer std.testing.allocator.free(tags);
    try std.testing.expectEqualSlices([]const u8, &.{ "random", "cached", "host" }, tags);
}

test "protobuf JSON Value converts recursively and preserves record order" {
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"first\":[1,2.5,null],\"second\":true}",
        .{},
    );
    defer parsed.deinit();
    var value = try fromJson(std.testing.allocator, parsed.value);
    defer deinit(&value, std.testing.allocator);

    try std.testing.expect(value == .record);
    const keys = value.record.keys();
    try std.testing.expectEqualStrings("first", keys[0]);
    try std.testing.expectEqualStrings("second", keys[1]);
    const first = value.record.get("first").?;
    try std.testing.expect(first == .array);
    try std.testing.expectEqual(@as(f64, 1), first.array.items[0].number);
    try std.testing.expectEqual(NullReason.unknown, first.array.items[2].null_value);
}
