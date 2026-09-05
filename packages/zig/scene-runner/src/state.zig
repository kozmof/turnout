const std = @import("std");
const value = @import("turnout_runtime").value;

pub const StateError = error{
    OutOfMemory,
    ReservedPath,
    UnknownPath,
    UnknownSchemaType,
    TypeMismatch,
    InvalidStateModel,
    InvalidLiteral,
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

/// An index into a schema's node pool, naming one parsed declaration type.
pub const TypeId = u32;

/// What a schema knows about one declared path.
pub const Declared = union(enum) {
    /// Declared with no type: any value may be written.
    unchecked,
    parsed: TypeId,
    /// The declaration named a type that does not parse. Declaring it is
    /// allowed and reading is allowed; only writing raises `UnknownSchemaType`,
    /// which is where that error surfaced when types were parsed on each write.
    invalid,
};

/// The declared shape of STATE: which paths exist, and the type each one's
/// values must match.
///
/// A schema is built once, before the State that owns it is ever snapshotted,
/// and never changes afterwards. Two things follow, and both used to be paid on
/// every action. Snapshots share a schema by reference instead of duplicating
/// every path and type string into the copy. And each declaration's type is
/// parsed into a node pool once, so validating a write walks parsed nodes rather
/// than re-parsing `"arr<number>"` from scratch.
pub const Schema = struct {
    arena: std.heap.ArenaAllocator,
    /// Declaration order is preserved. A null type means the path is declared
    /// but its values are unchecked.
    fields: std.StringArrayHashMapUnmanaged(Declared) = .empty,
    nodes: std.ArrayList(SchemaNode) = .empty,
    /// Snapshots share one schema; it is freed when the last State drops it.
    references: usize = 1,

    fn create(parent: std.mem.Allocator) StateError!*Schema {
        const schema = try parent.create(Schema);
        schema.* = .{ .arena = .init(parent) };
        return schema;
    }

    fn acquire(self: *Schema) *Schema {
        self.references += 1;
        return self;
    }

    fn release(self: *Schema, parent: std.mem.Allocator) void {
        self.references -= 1;
        if (self.references > 0) return;
        self.arena.deinit();
        parent.destroy(self);
    }

    /// Declares `path`, replacing any type already declared for it. Only valid
    /// while the schema is still being built.
    fn declare(self: *Schema, path: []const u8, schema_type: ?[]const u8) StateError!void {
        try validatePath(path);
        const allocator = self.arena.allocator();
        const declared: Declared = if (schema_type) |source|
            if (self.appendType(source)) |type_id|
                .{ .parsed = type_id }
            else |_|
                .invalid
        else
            .unchecked;
        if (self.fields.getPtr(path)) |existing| {
            existing.* = declared;
            return;
        }
        try self.fields.put(allocator, try allocator.dupe(u8, path), declared);
    }

    /// Parses one declaration type into the shared pool, rebasing the parser's
    /// own node indices onto it.
    fn appendType(self: *Schema, source: []const u8) StateError!TypeId {
        const parsed = try parseSchemaType(source);
        const allocator = self.arena.allocator();
        const offset: TypeId = @intCast(self.nodes.items.len);
        try self.nodes.ensureUnusedCapacity(allocator, parsed.node_count);
        for (parsed.nodes[0..parsed.node_count]) |node| {
            self.nodes.appendAssumeCapacity(switch (node) {
                .array => |child| .{ .array = child + offset },
                .record => |record| .{ .record = .{
                    .numeric_keys = record.numeric_keys,
                    .child = record.child + offset,
                } },
                else => node,
            });
        }
        return offset + @as(TypeId, @intCast(parsed.root_index));
    }

    pub fn contains(self: *const Schema, path: []const u8) bool {
        return self.fields.contains(path);
    }

    /// What is declared for `path`, or null when it is not declared at all.
    pub fn typeOf(self: *const Schema, path: []const u8) ?Declared {
        return self.fields.get(path);
    }

    pub fn matches(self: *const Schema, type_id: TypeId, candidate: value.Value) bool {
        return matchesNode(candidate, self.nodes.items, type_id);
    }
};

pub const State = struct {
    entries: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty,
    /// Shared with every snapshot taken of this State, and immutable once the
    /// State is in use.
    schema: ?*Schema = null,

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
        var state: State = .{ .schema = try Schema.create(allocator) };
        errdefer state.deinit(allocator);
        for (declarations) |declaration| {
            if (state.schema.?.contains(declaration.path)) continue;
            try state.schema.?.declare(declaration.path, declaration.schema_type);
        }
        var iterator = initial.iterator();
        while (iterator.next()) |entry| try state.set(entry.key_ptr.*, entry.value_ptr.*, allocator);
        return state;
    }

    pub fn initFromModel(
        state_model: std.json.Value,
        overrides: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        allocator: std.mem.Allocator,
    ) StateError!State {
        if (state_model != .object) return error.InvalidStateModel;
        const namespaces = state_model.object.get("namespaces") orelse
            return State.initStrict(overrides, &.{}, allocator);
        if (namespaces != .array) return error.InvalidStateModel;

        var state: State = .{ .schema = try Schema.create(allocator) };
        errdefer state.deinit(allocator);
        for (namespaces.array.items) |namespace| {
            if (namespace != .object) return error.InvalidStateModel;
            const namespace_name = namespace.object.get("name") orelse return error.InvalidStateModel;
            if (namespace_name != .string or namespace_name.string.len == 0)
                return error.InvalidStateModel;
            const fields = namespace.object.get("fields") orelse continue;
            if (fields != .array) return error.InvalidStateModel;
            for (fields.array.items) |field| {
                if (field != .object) return error.InvalidStateModel;
                const field_name = field.object.get("name") orelse return error.InvalidStateModel;
                const schema_type = field.object.get("type") orelse return error.InvalidStateModel;
                if (field_name != .string or field_name.string.len == 0 or
                    schema_type != .string or schema_type.string.len == 0)
                    return error.InvalidStateModel;
                const path = try std.fmt.allocPrint(allocator, "{s}.{s}", .{
                    namespace_name.string,
                    field_name.string,
                });
                defer allocator.free(path);
                try state.schema.?.declare(path, schema_type.string);

                var default_value = if (field.object.get("value")) |literal|
                    try literalToValue(literal, schema_type.string, allocator)
                else
                    try value.buildNull(.missing, &.{}, allocator);
                defer default_value.deinit(allocator);
                try state.setOwned(path, default_value.borrowed(), allocator);
            }
        }
        var override_iterator = overrides.iterator();
        while (override_iterator.next()) |entry|
            try state.set(entry.key_ptr.*, entry.value_ptr.*, allocator);
        return state;
    }

    pub fn deinit(self: *State, allocator: std.mem.Allocator) void {
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(allocator);
        }
        self.entries.deinit(allocator);
        if (self.schema) |schema| schema.release(allocator);
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

    pub fn isSchemaManaged(self: *const State) bool {
        return self.schema != null;
    }

    pub fn snapshot(self: *const State, allocator: std.mem.Allocator) StateError!State {
        // The schema never changes once a State is in use, so a snapshot shares
        // it rather than duplicating every path and type into the copy.
        var result: State = .{ .schema = if (self.schema) |schema| schema.acquire() else null };
        errdefer result.deinit(allocator);
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry|
            try result.set(entry.key_ptr.*, entry.value_ptr.borrowed(), allocator);
        return result;
    }

    pub fn canonicalJson(self: *const State, allocator: std.mem.Allocator) ![]u8 {
        var borrowed: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
        defer borrowed.deinit(allocator);
        var iterator = self.entries.iterator();
        while (iterator.next()) |entry|
            try borrowed.put(allocator, entry.key_ptr.*, entry.value_ptr.borrowed());
        return value.canonicalMapJson(&borrowed, allocator);
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
        return self.setOwned(path, new_value, allocator);
    }

    fn setOwned(
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

    fn validateWrite(self: *const State, path: []const u8, new_value: value.TaggedValue) StateError!void {
        try validatePath(path);
        const schema = self.schema orelse return;
        switch (schema.typeOf(path) orelse return error.UnknownPath) {
            .unchecked => {},
            .invalid => return error.UnknownSchemaType,
            .parsed => |type_id| if (!schema.matches(type_id, new_value.value))
                return error.TypeMismatch,
        }
    }
};

pub fn validatePath(path: []const u8) StateError!void {
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

/// Parses `schema_type` and checks `candidate` against it.
///
/// This is the one-off path, used by the authoring ABI. The write path uses a
/// schema's pre-parsed types instead of coming through here.
pub fn matchesSchemaType(candidate: value.Value, schema_type: []const u8) StateError!bool {
    const parser = try parseSchemaType(schema_type);
    return matchesNode(candidate, parser.nodes[0..parser.node_count], parser.root_index);
}

pub fn literalToValue(
    literal: std.json.Value,
    schema_type: []const u8,
    allocator: std.mem.Allocator,
) StateError!value.OwnedTaggedValue {
    if (literal == .null) return value.buildNull(.missing, &.{}, allocator);
    var converted = value.fromJson(allocator, literal) catch return error.InvalidLiteral;
    errdefer value.deinitValue(&converted, allocator);
    if (!try matchesSchemaType(converted, schema_type)) return error.InvalidLiteral;
    if (converted == .array) converted.array.element = arrayElement(schema_type);
    return .{ .value = converted, .tags = try allocator.alloc([]const u8, 0) };
}

fn arrayElement(schema_type: []const u8) value.ArrayElement {
    if (std.mem.eql(u8, schema_type, "arr<number>")) return .number;
    if (std.mem.eql(u8, schema_type, "arr<str>")) return .string;
    if (std.mem.eql(u8, schema_type, "arr<bool>")) return .boolean;
    return .untyped;
}

fn matchesNode(candidate: value.Value, nodes: []const SchemaNode, node_index: usize) bool {
    return switch (nodes[node_index]) {
        .number => candidate == .number,
        .string => candidate == .string,
        .boolean => candidate == .boolean,
        .array => |child| blk: {
            if (candidate != .array) break :blk false;
            for (candidate.array.items) |item|
                if (!matchesNode(item.value, nodes, child)) break :blk false;
            break :blk true;
        },
        .record => |record| blk: {
            if (candidate != .record) break :blk false;
            var iterator = candidate.record.iterator();
            while (iterator.next()) |entry| {
                if (record.numeric_keys and !validNumberKey(entry.key_ptr.*)) break :blk false;
                if (!matchesNode(entry.value_ptr.value, nodes, record.child)) break :blk false;
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

test "state canonical JSON preserves snapshot order and tags" {
    var initial: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer initial.deinit(std.testing.allocator);
    try initial.put(std.testing.allocator, "app.count", .{
        .value = .{ .number = 3 },
        .tags = &.{"initial"},
    });
    try initial.put(std.testing.allocator, "app.ready", .{ .value = .{ .boolean = true } });
    var state = try State.initUnchecked(&initial, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    const json = try state.canonicalJson(std.testing.allocator);
    defer std.testing.allocator.free(json);
    try std.testing.expectEqualStrings(
        "{\"app.count\":{\"symbol\":\"number\",\"value\":3,\"tags\":[\"initial\"]},\"app.ready\":{\"symbol\":\"boolean\",\"value\":true,\"tags\":[]}}",
        json,
    );
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

test "state initializes defaults and overrides from model JSON" {
    const allocator = std.testing.allocator;
    const source =
        \\{"namespaces":[{"name":"player","fields":[
        \\{"name":"score","type":"number","value":1},
        \\{"name":"tags","type":"arr<str>","value":["new"]},
        \\{"name":"note","type":"unknown","value":null}
        \\]}]}
    ;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, source, .{});
    defer parsed.deinit();
    var overrides: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer overrides.deinit(allocator);
    try overrides.put(allocator, "player.score", .{ .value = .{ .number = 42 } });

    var state = try State.initFromModel(parsed.value, &overrides, allocator);
    defer state.deinit(allocator);
    var score = try state.read("player.score", allocator);
    defer score.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 42), score.value.number);
    var tags = try state.read("player.tags", allocator);
    defer tags.deinit(allocator);
    try std.testing.expectEqual(value.ArrayElement.string, tags.value.array.element);
    var note = try state.read("player.note", allocator);
    defer note.deinit(allocator);
    try std.testing.expectEqual(value.NullReason.missing, note.value.null_value);
    try std.testing.expectError(
        error.UnknownSchemaType,
        state.write("player.note", .{ .value = .{ .number = 1 } }, allocator),
    );
}

test "state model rejects invalid defaults and overrides" {
    const allocator = std.testing.allocator;
    const invalid_source =
        \\{"namespaces":[{"name":"player","fields":[
        \\{"name":"score","type":"number","value":"wrong"}
        \\]}]}
    ;
    const invalid = try std.json.parseFromSlice(std.json.Value, allocator, invalid_source, .{});
    defer invalid.deinit();
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    try std.testing.expectError(error.InvalidLiteral, State.initFromModel(invalid.value, &empty, allocator));

    const valid_source =
        \\{"namespaces":[{"name":"player","fields":[
        \\{"name":"score","type":"number","value":0}
        \\]}]}
    ;
    const valid = try std.json.parseFromSlice(std.json.Value, allocator, valid_source, .{});
    defer valid.deinit();
    var overrides: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer overrides.deinit(allocator);
    try overrides.put(allocator, "player.score", .{ .value = .{ .string = "wrong" } });
    try std.testing.expectError(error.TypeMismatch, State.initFromModel(valid.value, &overrides, allocator));
}
