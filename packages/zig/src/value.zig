const std = @import("std");

pub const NullReason = enum { missing, not_found, @"error", filtered, redacted, unknown };
pub const ArrayElement = enum { untyped, number, string, boolean, null_value };

pub const Value = union(enum) {
    number: f64,
    string: []const u8,
    boolean: bool,
    null_value: NullReason,
    array: Array,
    record: std.StringArrayHashMapUnmanaged(TaggedValue),

    pub const Array = struct { element: ArrayElement = .untyped, items: []TaggedValue };

    pub fn eql(a: Value, b: Value) bool {
        if (std.meta.activeTag(a) != std.meta.activeTag(b)) return false;
        return switch (a) {
            .number => |x| x == b.number,
            .string => |x| std.mem.eql(u8, x, b.string),
            .boolean => |x| x == b.boolean,
            .null_value => true,
            .array => |x| blk: {
                if (x.items.len != b.array.items.len) break :blk false;
                for (x.items, b.array.items) |left, right| if (!left.value.eql(right.value)) break :blk false;
                break :blk true;
            },
            .record => |x| blk: {
                if (x.count() != b.record.count()) break :blk false;
                var it = x.iterator();
                while (it.next()) |entry| {
                    const right = b.record.get(entry.key_ptr.*) orelse break :blk false;
                    if (!entry.value_ptr.value.eql(right.value)) break :blk false;
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
            const items = try allocator.alloc(TaggedValue, array.items.len);
            errdefer allocator.free(items);
            var initialized: usize = 0;
            errdefer for (items[0..initialized]) |*item| deinitTagged(item, allocator);
            for (array.items, 0..) |item, index| {
                items[index] = .{
                    .value = try fromJson(allocator, item),
                    .tags = allocator.alloc([]const u8, 0) catch |err| {
                        deinitValue(&items[index].value, allocator);
                        return err;
                    },
                };
                initialized += 1;
            }
            break :blk .{ .array = .{ .items = items } };
        },
        .object => |object| blk: {
            var record: std.StringArrayHashMapUnmanaged(TaggedValue) = .empty;
            errdefer deinitRecord(&record, allocator);
            var iterator = object.iterator();
            while (iterator.next()) |entry| {
                const key = try allocator.dupe(u8, entry.key_ptr.*);
                var owned_value = fromJson(allocator, entry.value_ptr.*) catch |err| {
                    allocator.free(key);
                    return err;
                };
                var item: TaggedValue = .{
                    .value = owned_value,
                    .tags = allocator.alloc([]const u8, 0) catch |err| {
                        allocator.free(key);
                        deinitValue(&owned_value, allocator);
                        return err;
                    },
                };
                record.put(allocator, key, item) catch |err| {
                    allocator.free(key);
                    deinitTagged(&item, allocator);
                    return err;
                };
            }
            break :blk .{ .record = record };
        },
    };
}

pub fn canonicalJson(tagged: TaggedValue, allocator: std.mem.Allocator) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(CanonicalTagged{ .tagged = tagged }, .{}, &output.writer);
    return output.toOwnedSlice();
}

pub fn canonicalMapJson(
    values: *const std.StringArrayHashMapUnmanaged(TaggedValue),
    allocator: std.mem.Allocator,
) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    var writer: std.json.Stringify = .{ .writer = &output.writer, .options = .{} };
    try writer.beginObject();
    var iterator = values.iterator();
    while (iterator.next()) |entry| {
        try writer.objectField(entry.key_ptr.*);
        try writer.write(CanonicalTagged{ .tagged = entry.value_ptr.* });
    }
    try writer.endObject();
    return output.toOwnedSlice();
}

pub const CanonicalError = error{ OutOfMemory, InvalidCanonicalValue };

pub const ParsedCanonical = struct {
    parsed: std.json.Parsed(std.json.Value),
    tagged: OwnedTaggedValue,

    pub fn init(bytes: []const u8, allocator: std.mem.Allocator) CanonicalError!ParsedCanonical {
        const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{}) catch
            return error.InvalidCanonicalValue;
        errdefer parsed.deinit();
        return .{
            .parsed = parsed,
            .tagged = try fromCanonicalValue(parsed.value, allocator),
        };
    }

    pub fn deinit(self: *ParsedCanonical, allocator: std.mem.Allocator) void {
        self.tagged.deinit(allocator);
        self.parsed.deinit();
        self.* = undefined;
    }
};

pub fn fromCanonicalValue(json: std.json.Value, allocator: std.mem.Allocator) CanonicalError!OwnedTaggedValue {
    if (json != .object) return error.InvalidCanonicalValue;
    const symbol = json.object.get("symbol") orelse return error.InvalidCanonicalValue;
    const raw = json.object.get("value") orelse return error.InvalidCanonicalValue;
    const raw_tags = json.object.get("tags") orelse return error.InvalidCanonicalValue;
    if (symbol != .string or raw_tags != .array) return error.InvalidCanonicalValue;
    const tags = try allocator.alloc([]const u8, raw_tags.array.items.len);
    errdefer allocator.free(tags);
    for (raw_tags.array.items, 0..) |tag, index| {
        if (tag != .string) return error.InvalidCanonicalValue;
        tags[index] = tag.string;
    }
    const decoded = try decodeCanonicalValue(symbol.string, raw, json.object.get("reason"), allocator);
    return .{ .value = decoded, .tags = tags };
}

fn decodeCanonicalValue(
    symbol: []const u8,
    raw: std.json.Value,
    raw_reason: ?std.json.Value,
    allocator: std.mem.Allocator,
) CanonicalError!Value {
    if (std.mem.eql(u8, symbol, "number")) {
        const number: f64 = switch (raw) {
            .integer => |integer| @floatFromInt(integer),
            .float => |float| float,
            else => return error.InvalidCanonicalValue,
        };
        if (!std.math.isFinite(number)) return error.InvalidCanonicalValue;
        return .{ .number = number };
    }
    if (std.mem.eql(u8, symbol, "string")) {
        if (raw != .string) return error.InvalidCanonicalValue;
        return .{ .string = try allocator.dupe(u8, raw.string) };
    }
    if (std.mem.eql(u8, symbol, "boolean")) {
        if (raw != .bool) return error.InvalidCanonicalValue;
        return .{ .boolean = raw.bool };
    }
    if (std.mem.eql(u8, symbol, "null")) {
        if (raw != .null) return error.InvalidCanonicalValue;
        const reason = raw_reason orelse return error.InvalidCanonicalValue;
        if (reason != .string) return error.InvalidCanonicalValue;
        return .{ .null_value = std.meta.stringToEnum(NullReason, reason.string) orelse
            return error.InvalidCanonicalValue };
    }
    if (std.mem.eql(u8, symbol, "array")) {
        if (raw != .array) return error.InvalidCanonicalValue;
        const items = try allocator.alloc(TaggedValue, raw.array.items.len);
        errdefer allocator.free(items);
        var initialized: usize = 0;
        errdefer for (items[0..initialized]) |*item| deinitTagged(item, allocator);
        for (raw.array.items, 0..) |raw_item, index| {
            const item = try fromCanonicalValue(raw_item, allocator);
            items[index] = item.borrowed();
            initialized += 1;
        }
        return .{ .array = .{ .items = items } };
    }
    if (std.mem.eql(u8, symbol, "record")) {
        if (raw != .object) return error.InvalidCanonicalValue;
        var record: std.StringArrayHashMapUnmanaged(TaggedValue) = .empty;
        errdefer deinitRecord(&record, allocator);
        var iterator = raw.object.iterator();
        while (iterator.next()) |entry| {
            const key = try allocator.dupe(u8, entry.key_ptr.*);
            const item = fromCanonicalValue(entry.value_ptr.*, allocator) catch |err| {
                allocator.free(key);
                return err;
            };
            record.put(allocator, key, item.borrowed()) catch |err| {
                allocator.free(key);
                var borrowed = item.borrowed();
                deinitTagged(&borrowed, allocator);
                return err;
            };
        }
        return .{ .record = record };
    }
    return error.InvalidCanonicalValue;
}

pub const CanonicalTagged = struct {
    tagged: TaggedValue,

    pub fn jsonStringify(self: CanonicalTagged, writer: anytype) !void {
        try writer.beginObject();
        try writer.objectField("symbol");
        try writer.write(switch (self.tagged.value) {
            .number => "number",
            .string => "string",
            .boolean => "boolean",
            .null_value => "null",
            .array => "array",
            .record => "record",
        });
        switch (self.tagged.value) {
            .number => |number| {
                try writer.objectField("value");
                try writer.write(number);
            },
            .string => |string| {
                try writer.objectField("value");
                try writer.write(string);
            },
            .boolean => |boolean| {
                try writer.objectField("value");
                try writer.write(boolean);
            },
            .null_value => |reason| {
                try writer.objectField("value");
                try writer.write(null);
                try writer.objectField("reason");
                try writer.write(@tagName(reason));
            },
            .array => |array| {
                try writer.objectField("value");
                try writer.beginArray();
                for (array.items) |item| try writer.write(CanonicalTagged{ .tagged = item });
                try writer.endArray();
            },
            .record => |record| {
                try writer.objectField("value");
                try writer.beginObject();
                var iterator = record.iterator();
                while (iterator.next()) |entry| {
                    try writer.objectField(entry.key_ptr.*);
                    try writer.write(CanonicalTagged{ .tagged = entry.value_ptr.* });
                }
                try writer.endObject();
            },
        }
        try writer.objectField("tags");
        try writer.write(self.tagged.tags);
        try writer.endObject();
    }
};

pub fn cloneValue(value: Value, allocator: std.mem.Allocator) std.mem.Allocator.Error!Value {
    return switch (value) {
        .number => |number| .{ .number = number },
        .string => |string| .{ .string = try allocator.dupe(u8, string) },
        .boolean => |boolean| .{ .boolean = boolean },
        .null_value => |reason| .{ .null_value = reason },
        .array => |array| blk: {
            const items = try allocator.alloc(TaggedValue, array.items.len);
            errdefer allocator.free(items);
            var initialized: usize = 0;
            errdefer for (items[0..initialized]) |*item| deinitTagged(item, allocator);
            for (array.items, 0..) |item, index| {
                items[index] = try cloneTagged(item, allocator);
                initialized += 1;
            }
            break :blk .{ .array = .{ .element = array.element, .items = items } };
        },
        .record => |record| blk: {
            var result: std.StringArrayHashMapUnmanaged(TaggedValue) = .empty;
            errdefer deinitRecord(&result, allocator);
            var iterator = record.iterator();
            while (iterator.next()) |entry| {
                const key = try allocator.dupe(u8, entry.key_ptr.*);
                var item = cloneTagged(entry.value_ptr.*, allocator) catch |err| {
                    allocator.free(key);
                    return err;
                };
                result.put(allocator, key, item) catch |err| {
                    allocator.free(key);
                    deinitTagged(&item, allocator);
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
            for (array.items) |*item| deinitTagged(item, allocator);
            allocator.free(array.items);
        },
        .record => |*record| deinitRecord(record, allocator),
        else => {},
    }
    self.* = undefined;
}

fn cloneTagged(tagged: TaggedValue, allocator: std.mem.Allocator) std.mem.Allocator.Error!TaggedValue {
    return .{
        .value = try cloneValue(tagged.value, allocator),
        .tags = try mergeTags(tagged.tags, &.{}, allocator),
    };
}

fn deinitTagged(tagged: *TaggedValue, allocator: std.mem.Allocator) void {
    deinitValue(&tagged.value, allocator);
    allocator.free(tagged.tags);
    tagged.* = undefined;
}

pub fn deinitTaggedValue(tagged: *TaggedValue, allocator: std.mem.Allocator) void {
    deinitTagged(tagged, allocator);
}

fn deinitRecord(record: *std.StringArrayHashMapUnmanaged(TaggedValue), allocator: std.mem.Allocator) void {
    var iterator = record.iterator();
    while (iterator.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        deinitTagged(entry.value_ptr, allocator);
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
    var items = [_]TaggedValue{.{ .value = .{ .number = 1 } }};
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
    try std.testing.expect(first.value == .array);
    try std.testing.expectEqual(@as(f64, 1), first.value.array.items[0].value.number);
    try std.testing.expectEqual(NullReason.unknown, first.value.array.items[2].value.null_value);
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

test "recursive clone preserves nested tags independently" {
    var children = [_]TaggedValue{.{ .value = .{ .number = 1 }, .tags = &.{"child"} }};
    const source: Value = .{ .array = .{ .items = &children } };
    var cloned = try cloneValue(source, std.testing.allocator);
    defer deinitValue(&cloned, std.testing.allocator);
    try std.testing.expectEqualSlices([]const u8, &.{"child"}, cloned.array.items[0].tags);
    try std.testing.expect(cloned.array.items[0].tags.ptr != children[0].tags.ptr);
}

test "canonical JSON preserves nested values tags and record order" {
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"first\":[1,null],\"second\":true}",
        .{},
    );
    defer parsed.deinit();
    var converted = try fromJson(std.testing.allocator, parsed.value);
    defer deinitValue(&converted, std.testing.allocator);
    var tagged = try build(converted, &.{"context"}, std.testing.allocator);
    defer tagged.deinit(std.testing.allocator);
    const json = try canonicalJson(tagged.borrowed(), std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings(
        "{\"symbol\":\"record\",\"value\":{\"first\":{\"symbol\":\"array\",\"value\":[{\"symbol\":\"number\",\"value\":1,\"tags\":[]},{\"symbol\":\"null\",\"value\":null,\"reason\":\"unknown\",\"tags\":[]}],\"tags\":[]},\"second\":{\"symbol\":\"boolean\",\"value\":true,\"tags\":[]}},\"tags\":[\"context\"]}",
        json,
    );
}

test "canonical map JSON preserves binding order" {
    var values: std.StringArrayHashMapUnmanaged(TaggedValue) = .empty;
    defer values.deinit(std.testing.allocator);
    try values.put(std.testing.allocator, "first", .{ .value = .{ .number = 1 } });
    try values.put(std.testing.allocator, "second", .{
        .value = .{ .string = "two" },
        .tags = &.{"prepared"},
    });
    const json = try canonicalMapJson(&values, std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings(
        "{\"first\":{\"symbol\":\"number\",\"value\":1,\"tags\":[]},\"second\":{\"symbol\":\"string\",\"value\":\"two\",\"tags\":[\"prepared\"]}}",
        json,
    );
}

test "parsed canonical owner retains nested tags and null reasons" {
    const source = "{\"symbol\":\"record\",\"value\":{\"items\":{\"symbol\":\"array\",\"value\":[{\"symbol\":\"null\",\"value\":null,\"reason\":\"filtered\",\"tags\":[\"nested\"]}],\"tags\":[]}},\"tags\":[\"root\"]}";
    var parsed = try ParsedCanonical.init(source, std.testing.allocator);
    defer parsed.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 1), parsed.tagged.tags.len);
    try std.testing.expectEqualStrings("root", parsed.tagged.tags[0]);
    const nested = parsed.tagged.value.record.get("items").?.value.array.items[0];
    try std.testing.expectEqual(NullReason.filtered, nested.value.null_value);
    try std.testing.expectEqual(@as(usize, 1), nested.tags.len);
    try std.testing.expectEqualStrings("nested", nested.tags[0]);
    const json = try canonicalJson(parsed.tagged.borrowed(), std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings(source, json);
}
