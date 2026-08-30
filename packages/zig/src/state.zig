const std = @import("std");
const value = @import("value.zig");

pub const StateError = error{
    OutOfMemory,
    ReservedPath,
    UnknownPath,
    UnknownSchemaType,
    TypeMismatch,
};

pub const Declaration = struct {
    path: []const u8,
    schema_type: ?[]const u8 = null,
};

const reserved_paths = [_][]const u8{
    "__proto__",
    "constructor",
    "prototype",
    "hasOwnProperty",
    "toString",
    "valueOf",
    "toLocaleString",
    "isPrototypeOf",
    "propertyIsEnumerable",
};

pub const State = struct {
    entries: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty,
    schema: ?std.StringArrayHashMapUnmanaged(?[]const u8) = null,

    pub fn initUnchecked(
        initial: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        allocator: std.mem.Allocator,
    ) StateError!State {
        var state: State = .{};
        errdefer state.deinit(allocator);
        var iterator = initial.iterator();
        while (iterator.next()) |entry| {
            try validatePath(entry.key_ptr.*);
            try state.set(entry.key_ptr.*, entry.value_ptr.*, allocator);
        }
        return state;
    }

    pub fn initStrict(
        initial: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        declarations: []const Declaration,
        allocator: std.mem.Allocator,
    ) StateError!State {
        var state: State = .{ .schema = .empty };
        errdefer state.deinit(allocator);
        for (declarations) |declaration| {
            try validatePath(declaration.path);
            if (state.schema.?.contains(declaration.path)) continue;
            if (declaration.schema_type) |schema_type| {
                _ = try parseSchemaType(schema_type);
            }
            const path = try allocator.dupe(u8, declaration.path);
            const schema_type = if (declaration.schema_type) |source|
                allocator.dupe(u8, source) catch |err| {
                    allocator.free(path);
                    return err;
                }
            else
                null;
            state.schema.?.put(allocator, path, schema_type) catch |err| {
                if (schema_type) |owned| allocator.free(owned);
                return err;
            };
        }
        var iterator = initial.iterator();
        while (iterator.next()) |entry| try state.set(entry.key_ptr.*, entry.value_ptr.*, allocator);
        return state;
    }

    pub fn deinit(self: *State, allocator: std.mem.Allocator) void {
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(allocator);
        }
        self.entries.deinit(allocator);
        if (self.schema) |*schema| {
            var schema_iterator = schema.iterator();
            while (schema_iterator.next()) |entry| {
                allocator.free(entry.key_ptr.*);
                if (entry.value_ptr.*) |schema_type| allocator.free(schema_type);
            }
            schema.deinit(allocator);
        }
        self.* = undefined;
    }

    pub fn read(
        self: *const State,
        path: []const u8,
        allocator: std.mem.Allocator,
    ) StateError!value.OwnedTaggedValue {
        try validatePath(path);
        if (self.schema) |schema| {
            if (!schema.contains(path)) return error.UnknownPath;
        }
        const found = self.entries.get(path) orelse
            return value.buildNull(.missing, &.{}, allocator);
        return value.build(found.value, found.tags, allocator);
    }

    pub fn readOrNull(
        self: *const State,
        path: []const u8,
        allocator: std.mem.Allocator,
    ) StateError!?value.OwnedTaggedValue {
        try validatePath(path);
        if (self.schema) |schema| {
            if (!schema.contains(path)) return null;
        }
        const found = self.entries.get(path) orelse return null;
        return try value.build(found.value, found.tags, allocator);
    }

    pub fn exists(self: *const State, path: []const u8) StateError!bool {
        try validatePath(path);
        return self.entries.contains(path);
    }

    pub fn isDeclared(self: *const State, path: []const u8) StateError!bool {
        try validatePath(path);
        const schema = self.schema orelse return true;
        return schema.contains(path);
    }

    pub fn snapshot(self: *const State, allocator: std.mem.Allocator) StateError!State {
        var result: State = .{};
        errdefer result.deinit(allocator);
        if (self.schema) |schema| {
            result.schema = .empty;
            var schema_iterator = schema.iterator();
            while (schema_iterator.next()) |entry| {
                const path = try allocator.dupe(u8, entry.key_ptr.*);
                const schema_type = if (entry.value_ptr.*) |source|
                    allocator.dupe(u8, source) catch |err| {
                        allocator.free(path);
                        return err;
                    }
                else
                    null;
                result.schema.?.put(allocator, path, schema_type) catch |err| {
                    if (schema_type) |owned| allocator.free(owned);
                    return err;
                };
            }
        }
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry|
            try result.set(entry.key_ptr.*, entry.value_ptr.borrowed(), allocator);
        return result;
    }

    pub fn write(
        self: *const State,
        path: []const u8,
        new_value: value.TaggedValue,
        allocator: std.mem.Allocator,
    ) StateError!State {
        try validatePath(path);
        var result = try self.snapshot(allocator);
        errdefer result.deinit(allocator);
        try result.set(path, new_value, allocator);
        return result;
    }

    pub fn writeBatch(
        self: *const State,
        batch: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        allocator: std.mem.Allocator,
    ) StateError!State {
        var iterator = batch.iterator();
        while (iterator.next()) |entry| try validatePath(entry.key_ptr.*);

        var result = try self.snapshot(allocator);
        errdefer result.deinit(allocator);
        iterator = batch.iterator();
        while (iterator.next()) |entry|
            try result.set(entry.key_ptr.*, entry.value_ptr.*, allocator);
        return result;
    }

    fn set(
        self: *State,
        path: []const u8,
        new_value: value.TaggedValue,
        allocator: std.mem.Allocator,
    ) StateError!void {
        try self.validateWrite(path, new_value);
        var owned = try value.build(new_value.value, new_value.tags, allocator);
        if (self.entries.getPtr(path)) |existing| {
            existing.deinit(allocator);
            existing.* = owned;
            return;
        }
        const key = allocator.dupe(u8, path) catch |err| {
            owned.deinit(allocator);
            return err;
        };
        self.entries.put(allocator, key, owned) catch |err| {
            allocator.free(key);
            owned.deinit(allocator);
            return err;
        };
    }

    fn validateWrite(self: *const State, path: []const u8, new_value: value.TaggedValue) StateError!void {
        try validatePath(path);
        const schema = self.schema orelse return;
        const schema_type = schema.get(path) orelse return error.UnknownPath;
        if (schema_type) |expected| {
            if (!try matchesSchemaType(new_value.value, expected)) return error.TypeMismatch;
        }
    }
};

fn validatePath(path: []const u8) StateError!void {
    for (reserved_paths) |reserved|
        if (std.mem.eql(u8, path, reserved)) return error.ReservedPath;
}

const SchemaNode = union(enum) {
    number,
    string,
    boolean,
    array: usize,
    record: struct { numeric_keys: bool, child: usize },
};

const SchemaParser = struct {
    source: []const u8,
    index: usize = 0,
    nodes: [128]SchemaNode = undefined,
    node_count: usize = 0,
    root_index: usize = 0,

    fn parse(self: *SchemaParser) StateError!usize {
        self.spaces();
        if (self.take("number")) return self.add(.number);
        if (self.take("str")) return self.add(.string);
        if (self.take("bool")) return self.add(.boolean);
        if (self.take("arr<")) {
            const child = try self.parse();
            self.spaces();
            if (!self.take(">")) return error.UnknownSchemaType;
            return self.add(.{ .array = child });
        }
        if (self.take("rec<")) {
            self.spaces();
            const numeric_keys = if (self.take("str"))
                false
            else if (self.take("number"))
                true
            else
                return error.UnknownSchemaType;
            self.spaces();
            if (!self.take(",")) return error.UnknownSchemaType;
            const child = try self.parse();
            self.spaces();
            if (!self.take(">")) return error.UnknownSchemaType;
            return self.add(.{ .record = .{ .numeric_keys = numeric_keys, .child = child } });
        }
        return error.UnknownSchemaType;
    }

    fn add(self: *SchemaParser, node: SchemaNode) StateError!usize {
        if (self.node_count == self.nodes.len) return error.UnknownSchemaType;
        self.nodes[self.node_count] = node;
        self.node_count += 1;
        return self.node_count - 1;
    }

    fn spaces(self: *SchemaParser) void {
        while (self.index < self.source.len and self.source[self.index] == ' ') self.index += 1;
    }

    fn take(self: *SchemaParser, token: []const u8) bool {
        if (!std.mem.startsWith(u8, self.source[self.index..], token)) return false;
        self.index += token.len;
        return true;
    }
};

fn parseSchemaType(source: []const u8) StateError!SchemaParser {
    var parser = SchemaParser{ .source = source };
    parser.root_index = try parser.parse();
    parser.spaces();
    if (parser.index != source.len) return error.UnknownSchemaType;
    return parser;
}

pub fn matchesSchemaType(candidate: value.Value, schema_type: []const u8) StateError!bool {
    const parser = try parseSchemaType(schema_type);
    return matchesNode(candidate, &parser, parser.root_index);
}

fn matchesNode(candidate: value.Value, parser: *const SchemaParser, node_index: usize) bool {
    return switch (parser.nodes[node_index]) {
        .number => candidate == .number,
        .string => candidate == .string,
        .boolean => candidate == .boolean,
        .array => |child| blk: {
            if (candidate != .array) break :blk false;
            for (candidate.array.items) |item|
                if (!matchesNode(item.value, parser, child)) break :blk false;
            break :blk true;
        },
        .record => |record| blk: {
            if (candidate != .record) break :blk false;
            var iterator = candidate.record.iterator();
            while (iterator.next()) |entry| {
                if (record.numeric_keys and !validNumberKey(entry.key_ptr.*)) break :blk false;
                if (!matchesNode(entry.value_ptr.value, parser, record.child)) break :blk false;
            }
            break :blk true;
        },
    };
}

fn validNumberKey(key: []const u8) bool {
    const trimmed = std.mem.trim(u8, key, " ");
    if (trimmed.len == 0) return false;
    const number = std.fmt.parseFloat(f64, trimmed) catch return false;
    return std.math.isFinite(number);
}

test "unchecked state clones input and returns missing null" {
    const allocator = std.testing.allocator;
    var initial: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer initial.deinit(allocator);
    try initial.put(allocator, "player.name", .{ .value = .{ .string = "Ada" } });

    var state = try State.initUnchecked(&initial, allocator);
    defer state.deinit(allocator);
    var name = try state.read("player.name", allocator);
    defer name.deinit(allocator);
    try std.testing.expectEqualStrings("Ada", name.value.string);

    var missing = try state.read("player.score", allocator);
    defer missing.deinit(allocator);
    try std.testing.expectEqual(value.NullReason.missing, missing.value.null_value);
    try std.testing.expect(try state.isDeclared("any.path"));
    try std.testing.expect(!try state.exists("any.path"));
}

test "writes and snapshots preserve previous state" {
    const allocator = std.testing.allocator;
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var original = try State.initUnchecked(&empty, allocator);
    defer original.deinit(allocator);

    const number: value.TaggedValue = .{ .value = .{ .number = 7 } };
    var written = try original.write("score.value", number, allocator);
    defer written.deinit(allocator);
    try std.testing.expect(!try original.exists("score.value"));
    try std.testing.expect(try written.exists("score.value"));

    var copy = try written.snapshot(allocator);
    defer copy.deinit(allocator);
    var changed = try written.write("score.value", .{ .value = .{ .number = 9 } }, allocator);
    defer changed.deinit(allocator);
    var copied_value = (try copy.readOrNull("score.value", allocator)).?;
    defer copied_value.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 7), copied_value.value.number);
}

test "batch writes are atomic and reject reserved paths" {
    const allocator = std.testing.allocator;
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try State.initUnchecked(&empty, allocator);
    defer state.deinit(allocator);

    var invalid: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer invalid.deinit(allocator);
    try invalid.put(allocator, "valid.path", .{ .value = .{ .boolean = true } });
    try invalid.put(allocator, "constructor", .{ .value = .{ .boolean = false } });
    try std.testing.expectError(error.ReservedPath, state.writeBatch(&invalid, allocator));
    try std.testing.expect(!try state.exists("valid.path"));
}

test "strict state enforces declared paths and primitive types" {
    const allocator = std.testing.allocator;
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    const declarations = [_]Declaration{
        .{ .path = "player.score", .schema_type = "number" },
        .{ .path = "player.name", .schema_type = "str" },
        .{ .path = "player.ready", .schema_type = "bool" },
        .{ .path = "player.note" },
    };
    var state = try State.initStrict(&empty, &declarations, allocator);
    defer state.deinit(allocator);

    try std.testing.expect(try state.isDeclared("player.score"));
    try std.testing.expect(!try state.isDeclared("player.unknown"));
    try std.testing.expectError(error.UnknownPath, state.read("player.unknown", allocator));
    try std.testing.expect((try state.readOrNull("player.unknown", allocator)) == null);
    try std.testing.expectError(
        error.TypeMismatch,
        state.write("player.score", .{ .value = .{ .string = "wrong" } }, allocator),
    );
    try std.testing.expectError(
        error.UnknownPath,
        state.write("player.unknown", .{ .value = .{ .number = 1 } }, allocator),
    );

    var updated = try state.write("player.score", .{ .value = .{ .number = 10 } }, allocator);
    defer updated.deinit(allocator);
    var snapshot = try updated.snapshot(allocator);
    defer snapshot.deinit(allocator);
    try std.testing.expect(try snapshot.isDeclared("player.name"));
}

test "schema matcher validates nested arrays and records" {
    const allocator = std.testing.allocator;
    var scores: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer scores.deinit(allocator);
    try scores.put(allocator, "first", .{ .value = .{ .number = 1 } });
    const score_record = value.Value{ .record = scores };
    const items = [_]value.TaggedValue{.{ .value = score_record }};
    const nested = value.Value{ .array = .{ .items = @constCast(&items) } };
    try std.testing.expect(try matchesSchemaType(nested, "arr<rec<str, number>>"));
    try std.testing.expect(!try matchesSchemaType(nested, "arr<rec<str, bool>>"));

    var numeric: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer numeric.deinit(allocator);
    try numeric.put(allocator, "1.5", .{ .value = .{ .boolean = true } });
    try std.testing.expect(try matchesSchemaType(.{ .record = numeric }, "rec<number, bool>"));
    try numeric.put(allocator, "not-a-number", .{ .value = .{ .boolean = true } });
    try std.testing.expect(!try matchesSchemaType(.{ .record = numeric }, "rec<number, bool>"));
    try std.testing.expectError(error.UnknownSchemaType, matchesSchemaType(nested, "array<number>"));
}
