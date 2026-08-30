const std = @import("std");
const value = @import("value.zig");

pub const StateError = error{
    OutOfMemory,
    ReservedPath,
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

    pub fn deinit(self: *State, allocator: std.mem.Allocator) void {
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(allocator);
        }
        self.entries.deinit(allocator);
        self.* = undefined;
    }

    pub fn read(
        self: *const State,
        path: []const u8,
        allocator: std.mem.Allocator,
    ) StateError!value.OwnedTaggedValue {
        try validatePath(path);
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
        const found = self.entries.get(path) orelse return null;
        return try value.build(found.value, found.tags, allocator);
    }

    pub fn exists(self: *const State, path: []const u8) StateError!bool {
        try validatePath(path);
        return self.entries.contains(path);
    }

    pub fn isDeclared(_: *const State, path: []const u8) StateError!bool {
        try validatePath(path);
        return true;
    }

    pub fn snapshot(self: *const State, allocator: std.mem.Allocator) StateError!State {
        var result: State = .{};
        errdefer result.deinit(allocator);
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
};

fn validatePath(path: []const u8) StateError!void {
    for (reserved_paths) |reserved|
        if (std.mem.eql(u8, path, reserved)) return error.ReservedPath;
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
