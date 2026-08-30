const std = @import("std");

pub const NullReason = enum { missing, not_found, @"error", filtered, redacted, unknown };
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

pub const OwnedTaggedValue = struct {
    value: Value,
    tags: []const []const u8,

    pub fn borrowed(self: *const OwnedTaggedValue) TaggedValue {
        return .{ .value = self.value, .tags = self.tags };
    }

    pub fn deinit(self: *OwnedTaggedValue, allocator: std.mem.Allocator) void {
        deinitValue(&self.value, allocator);
        allocator.free(self.tags);
        self.* = undefined;
    }
};

pub fn isNumber(value: Value) bool {
    return value == .number;
}

pub fn isString(value: Value) bool {
    return value == .string;
}

pub fn isBoolean(value: Value) bool {
    return value == .boolean;
}

pub fn isNull(value: Value) bool {
    return value == .null_value;
}

pub fn isArray(value: Value) bool {
    return value == .array;
}

pub fn isRecord(value: Value) bool {
    return value == .record;
}

pub fn isPure(value: TaggedValue) bool {
    return value.tags.len == 0;
}

pub fn hasTag(value: TaggedValue, wanted: []const u8) bool {
    for (value.tags) |tag| if (std.mem.eql(u8, tag, wanted)) return true;
    return false;
}

pub fn build(value: Value, tags: []const []const u8, allocator: std.mem.Allocator) !OwnedTaggedValue {
    return .{
        .value = try cloneValue(value, allocator),
        .tags = try mergeTags(tags, &.{}, allocator),
    };
}

pub fn buildNumber(number: f64, tags: []const []const u8, allocator: std.mem.Allocator) !OwnedTaggedValue {
    return build(.{ .number = number }, tags, allocator);
}

pub fn buildString(string: []const u8, tags: []const []const u8, allocator: std.mem.Allocator) !OwnedTaggedValue {
    return build(.{ .string = string }, tags, allocator);
}

pub fn buildBoolean(boolean: bool, tags: []const []const u8, allocator: std.mem.Allocator) !OwnedTaggedValue {
    return build(.{ .boolean = boolean }, tags, allocator);
}

pub fn buildNull(reason: NullReason, tags: []const []const u8, allocator: std.mem.Allocator) !OwnedTaggedValue {
    return build(.{ .null_value = reason }, tags, allocator);
}

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
        .string => |string| .{ .string = try allocator.dupe(u8, string) },
        .array => |array| blk: {
            const items = try allocator.alloc(Value, array.items.len);
            errdefer allocator.free(items);
            var initialized: usize = 0;
            errdefer for (items[0..initialized]) |*item| deinitValue(item, allocator);
            for (array.items, 0..) |item, index| {
                items[index] = try fromJson(allocator, item);
                initialized += 1;
            }
            break :blk .{ .array = .{ .items = items } };
        },
        .object => |object| blk: {
            var record: std.StringArrayHashMapUnmanaged(Value) = .empty;
            errdefer deinitRecord(&record, allocator);
            var iterator = object.iterator();
            while (iterator.next()) |entry| {
                const key = try allocator.dupe(u8, entry.key_ptr.*);
                const item = fromJson(allocator, entry.value_ptr.*) catch |err| {
                    allocator.free(key);
                    return err;
                };
                record.put(allocator, key, item) catch |err| {
                    allocator.free(key);
                    var owned_item = item;
                    deinitValue(&owned_item, allocator);
                    return err;
                };
            }
            break :blk .{ .record = record };
        },
    };
}

pub fn cloneValue(value: Value, allocator: std.mem.Allocator) !Value {
    return switch (value) {
        .number => |number| .{ .number = number },
        .string => |string| .{ .string = try allocator.dupe(u8, string) },
        .boolean => |boolean| .{ .boolean = boolean },
        .null_value => |reason| .{ .null_value = reason },
        .array => |array| blk: {
            const items = try allocator.alloc(Value, array.items.len);
            errdefer allocator.free(items);
            var initialized: usize = 0;
            errdefer for (items[0..initialized]) |*item| deinitValue(item, allocator);
            for (array.items, 0..) |item, index| {
                items[index] = try cloneValue(item, allocator);
                initialized += 1;
            }
            break :blk .{ .array = .{ .element = array.element, .items = items } };
        },
        .record => |record| blk: {
            var result: std.StringArrayHashMapUnmanaged(Value) = .empty;
            errdefer deinitRecord(&result, allocator);
            var iterator = record.iterator();
            while (iterator.next()) |entry| {
                const key = try allocator.dupe(u8, entry.key_ptr.*);
                const item = cloneValue(entry.value_ptr.*, allocator) catch |err| {
                    allocator.free(key);
                    return err;
                };
                result.put(allocator, key, item) catch |err| {
                    allocator.free(key);
                    var owned_item = item;
                    deinitValue(&owned_item, allocator);
                    return err;
                };
            }
            break :blk .{ .record = result };
        },
    };
}

pub fn deinitValue(self: *Value, allocator: std.mem.Allocator) void {
    switch (self.*) {
        .string => |string| allocator.free(string),
        .array => |array| {
            for (array.items) |*item| deinitValue(item, allocator);
            allocator.free(array.items);
        },
        .record => |*record| deinitRecord(record, allocator),
        else => {},
    }
    self.* = undefined;
}

fn deinitRecord(record: *std.StringArrayHashMapUnmanaged(Value), allocator: std.mem.Allocator) void {
    var iterator = record.iterator();
    while (iterator.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        deinitValue(entry.value_ptr, allocator);
    }
    record.deinit(allocator);
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
    defer deinitValue(&value, std.testing.allocator);

    try std.testing.expect(value == .record);
    const keys = value.record.keys();
    try std.testing.expectEqualStrings("first", keys[0]);
    try std.testing.expectEqualStrings("second", keys[1]);
    const first = value.record.get("first").?;
    try std.testing.expect(first == .array);
    try std.testing.expectEqual(@as(f64, 1), first.array.items[0].number);
    try std.testing.expectEqual(NullReason.unknown, first.array.items[2].null_value);
}

test "owned builders clone data and deduplicate tags" {
    var built = try buildString("hello", &.{ "source", "source", "host" }, std.testing.allocator);
    defer built.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("hello", built.value.string);
    try std.testing.expectEqualSlices([]const u8, &.{ "source", "host" }, built.tags);
    try std.testing.expect(!isPure(built.borrowed()));
    try std.testing.expect(hasTag(built.borrowed(), "host"));
}

test "recursive clone has independent storage" {
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"key\":[\"value\"]}",
        .{},
    );
    defer parsed.deinit();
    var original = try fromJson(std.testing.allocator, parsed.value);
    defer deinitValue(&original, std.testing.allocator);
    var cloned = try cloneValue(original, std.testing.allocator);
    defer deinitValue(&cloned, std.testing.allocator);
    try std.testing.expect(original.eql(cloned));
    try std.testing.expect(original.record.keys()[0].ptr != cloned.record.keys()[0].ptr);
}
