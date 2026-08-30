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

    pub const Array = struct { element: ArrayElement = .untyped, items: []const Value };

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
    const items = [_]Value{.{ .number = 1 }};
    const a: Value = .{ .array = .{ .element = .number, .items = &items } };
    const b: Value = .{ .array = .{ .element = .untyped, .items = &items } };
    try std.testing.expect(a.eql(b));
}

test "tags merge in first-seen order" {
    const tags = try mergeTags(&.{ "random", "cached" }, &.{ "cached", "host" }, std.testing.allocator);
    defer std.testing.allocator.free(tags);
    try std.testing.expectEqualSlices([]const u8, &.{ "random", "cached", "host" }, tags);
}
