//! Combine separately compiled models into one.
//!
//! Scenes are compiled apart and brought together at run time, so nothing has
//! checked that they agree until now. Merging is where that check happens: ids
//! must not collide, and any STATE path or named type declared by more than one
//! input must be declared identically.
//!
//! The result is an ordinary model root. Load it, run it, or merge it again.
//!
//! This is the one implementation of those rules. The TypeScript `mergeModels`
//! calls it through the WASM boundary rather than repeating it, and the runtime
//! calls it directly when an action's `extend` hooks bring a model in mid-run.

const std = @import("std");

/// Which input a merged item came from.
///
/// The host rebuilds its own merged model from its own protobuf objects rather
/// than from the JSON returned here, because the runtime projection has already
/// dropped authoring metadata that a caller-facing model keeps. Recording the
/// winner per item is what lets it do that without repeating the rules.
pub const Origin = struct {
    pub const Kind = enum { scene, route, type_decl, field };

    kind: Kind,
    /// Scene, route or type name. For a field, "<namespace>.<field>".
    id: []const u8,
    /// Index of the input that declared it.
    input: usize,
};

pub const Merged = struct {
    root: std.json.Value,
    provenance: []const Origin,
};

pub const Outcome = union(enum) {
    merged: Merged,
    /// Every conflict found, not just the first: one merge reports everything
    /// wrong rather than the first thing wrong.
    conflicts: []const []const u8,
};

pub const Error = error{OutOfMemory};

/// Merge model roots left to right.
///
/// Every collision is an error rather than an override. Two models that both
/// define a scene do not have a defensible winner, and silently picking one
/// would turn a packaging mistake into a behavioural one. Rename the scene, or
/// drop it from one input.
///
/// `labels` names the inputs in conflict messages, positionally. Inputs without
/// a label are called "model 0", "model 1", and so on.
///
/// Everything returned is allocated from `arena`, except the sub-values copied
/// straight out of `roots`, which are borrowed. The result outlives neither.
pub fn merge(
    arena: std.mem.Allocator,
    roots: []const std.json.Value,
    labels: []const []const u8,
) Error!Outcome {
    var conflicts: Conflicts = .{ .arena = arena, .labels = labels };
    if (roots.len == 0) {
        try conflicts.add("no models to merge", .{});
        return .{ .conflicts = try conflicts.take() };
    }

    const first = objectOf(roots[0]) orelse {
        try conflicts.add("{s} is not a model", .{try conflicts.label(0)});
        return .{ .conflicts = try conflicts.take() };
    };

    var scenes = std.json.Array.init(arena);
    var routes = std.json.Array.init(arena);
    var type_decls = std.json.Array.init(arena);
    var namespaces = std.json.Array.init(arena);
    var provenance: std.ArrayList(Origin) = .empty;

    var scene_owners: std.StringHashMapUnmanaged(usize) = .empty;
    var route_owners: std.StringHashMapUnmanaged(usize) = .empty;
    var type_owners: std.StringHashMapUnmanaged(Declaration) = .empty;
    var field_owners: std.StringHashMapUnmanaged(Declaration) = .empty;
    // Namespace name to its position in `namespaces`, so fields accumulate.
    var namespace_slots: std.StringHashMapUnmanaged(usize) = .empty;

    var version = uintOf(first.get("version"));
    var min_version = uintOf(first.get("minVersion"));
    var max_version = uintOf(first.get("maxVersion"));

    for (roots, 0..) |root_value, index| {
        const root = objectOf(root_value) orelse {
            try conflicts.add("{s} is not a model", .{try conflicts.label(index)});
            continue;
        };

        const model_version = uintOf(root.get("version"));
        if (model_version != version) {
            try conflicts.add("{s} is version {d}, {s} is version {d}", .{
                try conflicts.label(index),
                model_version,
                try conflicts.label(0),
                version,
            });
            version = @max(version, model_version);
        }
        // The merged model must satisfy every input, so the window is the
        // tightest of them: the highest floor and the lowest declared ceiling.
        min_version = @max(min_version, uintOf(root.get("minVersion")));
        const model_max = uintOf(root.get("maxVersion"));
        if (model_max != 0) {
            max_version = if (max_version == 0) model_max else @min(max_version, model_max);
        }

        for (arrayOf(root.get("scenes"))) |scene_value| {
            const scene = objectOf(scene_value) orelse continue;
            const id = stringOf(scene.get("id")) orelse continue;
            if (scene_owners.get(id)) |owner| {
                try conflicts.add("scene \"{s}\" is declared by {s} and {s}", .{
                    id,
                    try conflicts.label(owner),
                    try conflicts.label(index),
                });
                continue;
            }
            try scene_owners.put(arena, id, index);
            try scenes.append(scene_value);
            try provenance.append(arena, .{ .kind = .scene, .id = id, .input = index });
        }

        for (arrayOf(root.get("routes"))) |route_value| {
            const route = objectOf(route_value) orelse continue;
            const id = stringOf(route.get("id")) orelse continue;
            if (route_owners.get(id)) |owner| {
                try conflicts.add("route \"{s}\" is declared by {s} and {s}", .{
                    id,
                    try conflicts.label(owner),
                    try conflicts.label(index),
                });
                continue;
            }
            try route_owners.put(arena, id, index);
            try routes.append(route_value);
            try provenance.append(arena, .{ .kind = .route, .id = id, .input = index });
        }

        const state = objectOf(root.get("state") orelse std.json.Value{ .null = {} });
        for (arrayOf(if (state) |object| object.get("namespaces") else null)) |namespace_value| {
            const namespace = objectOf(namespace_value) orelse continue;
            const name = stringOf(namespace.get("name")) orelse continue;
            const slot = namespace_slots.get(name) orelse slot: {
                const position = namespaces.items.len;
                try namespace_slots.put(arena, name, position);
                try namespaces.append(.{ .object = try withEmptyFields(arena, namespace) });
                break :slot position;
            };
            const merged = &namespaces.items[slot].object;

            for (arrayOf(namespace.get("fields"))) |field_value| {
                const field = objectOf(field_value) orelse continue;
                const field_name = stringOf(field.get("name")) orelse continue;
                const path = try std.fmt.allocPrint(arena, "{s}.{s}", .{ name, field_name });
                const encoded = try encodeField(arena, field);
                const owner = field_owners.get(path) orelse {
                    try field_owners.put(arena, path, .{ .input = index, .encoded = encoded });
                    try merged.getPtr("fields").?.array.append(field_value);
                    try provenance.append(arena, .{ .kind = .field, .id = path, .input = index });
                    continue;
                };
                // Declaring the same field the same way twice is agreement, not
                // a conflict: two scene sets that both need a field will both
                // declare it.
                if (std.mem.eql(u8, owner.encoded, encoded)) continue;
                try conflicts.add(
                    "STATE field \"{s}\" is declared as {s} by {s} and as {s} by {s}",
                    .{
                        path,
                        encoded,
                        try conflicts.label(index),
                        owner.encoded,
                        try conflicts.label(owner.input),
                    },
                );
            }
        }

        for (arrayOf(root.get("typeDecls"))) |decl_value| {
            const decl = objectOf(decl_value) orelse continue;
            const name = stringOf(decl.get("name")) orelse continue;
            const encoded = try stringifyValue(arena, decl_value);
            const owner = type_owners.get(name) orelse {
                try type_owners.put(arena, name, .{ .input = index, .encoded = encoded });
                try type_decls.append(decl_value);
                try provenance.append(arena, .{ .kind = .type_decl, .id = name, .input = index });
                continue;
            };
            if (std.mem.eql(u8, owner.encoded, encoded)) continue;
            try conflicts.add("type \"{s}\" is declared differently by {s} and {s}", .{
                name,
                try conflicts.label(owner.input),
                try conflicts.label(index),
            });
        }
    }

    if (conflicts.any()) return .{ .conflicts = try conflicts.take() };

    var merged = try cloneObject(arena, first);
    try merged.put(arena, "version", .{ .integer = @intCast(version) });
    try merged.put(arena, "minVersion", .{ .integer = @intCast(min_version) });
    try merged.put(arena, "maxVersion", .{ .integer = @intCast(max_version) });
    try merged.put(arena, "scenes", .{ .array = scenes });
    try merged.put(arena, "routes", .{ .array = routes });
    try merged.put(arena, "typeDecls", .{ .array = type_decls });
    // A model with no STATE stays without one, rather than gaining an empty
    // schema that would switch execution from unchecked to schema-managed.
    if (namespaces.items.len > 0) {
        var state = if (objectOf(first.get("state") orelse std.json.Value{ .null = {} })) |object|
            try cloneObject(arena, object)
        else
            std.json.ObjectMap.empty;
        try state.put(arena, "namespaces", .{ .array = namespaces });
        try merged.put(arena, "state", .{ .object = state });
    }

    return .{ .merged = .{
        .root = .{ .object = merged },
        .provenance = try provenance.toOwnedSlice(arena),
    } };
}

/// How an input declared something, as a comparable string, and who declared it.
const Declaration = struct {
    input: usize,
    encoded: []const u8,
};

/// Collects conflicts and renders input labels, so every message spells an
/// input the same way.
const Conflicts = struct {
    arena: std.mem.Allocator,
    labels: []const []const u8,
    items: std.ArrayList([]const u8) = .empty,

    fn label(self: *Conflicts, index: usize) Error![]const u8 {
        if (index < self.labels.len) return self.labels[index];
        return std.fmt.allocPrint(self.arena, "model {d}", .{index});
    }

    fn add(self: *Conflicts, comptime format: []const u8, args: anytype) Error!void {
        try self.items.append(self.arena, try std.fmt.allocPrint(self.arena, format, args));
    }

    fn any(self: *const Conflicts) bool {
        return self.items.items.len > 0;
    }

    fn take(self: *Conflicts) Error![]const []const u8 {
        return self.items.toOwnedSlice(self.arena);
    }
};

/// How a field is declared, as a comparable string.
fn encodeField(arena: std.mem.Allocator, field: std.json.ObjectMap) Error![]const u8 {
    const field_type = stringOf(field.get("type")) orelse "";
    const value = field.get("value") orelse std.json.Value{ .null = {} };
    return std.fmt.allocPrint(arena, "{s}={s}", .{ field_type, try stringifyValue(arena, value) });
}

fn stringifyValue(arena: std.mem.Allocator, value: std.json.Value) Error![]const u8 {
    var output: std.Io.Writer.Allocating = .init(arena);
    defer output.deinit();
    std.json.Stringify.value(value, .{}, &output.writer) catch return error.OutOfMemory;
    return arena.dupe(u8, output.written());
}

/// A shallow copy, so the merged root can override fields without touching the
/// input it was copied from. Key order is preserved, which is what keeps an
/// overridden field in the position it already had.
fn cloneObject(arena: std.mem.Allocator, object: std.json.ObjectMap) Error!std.json.ObjectMap {
    var copy: std.json.ObjectMap = .empty;
    try copy.ensureTotalCapacity(arena, object.count());
    var iterator = object.iterator();
    while (iterator.next()) |entry| try copy.put(arena, entry.key_ptr.*, entry.value_ptr.*);
    return copy;
}

/// The namespace as declared, with its fields emptied so merged ones accumulate.
fn withEmptyFields(arena: std.mem.Allocator, namespace: std.json.ObjectMap) Error!std.json.ObjectMap {
    var copy = try cloneObject(arena, namespace);
    try copy.put(arena, "fields", .{ .array = std.json.Array.init(arena) });
    return copy;
}

fn objectOf(value: ?std.json.Value) ?std.json.ObjectMap {
    const found = value orelse return null;
    return if (found == .object) found.object else null;
}

fn arrayOf(value: ?std.json.Value) []const std.json.Value {
    const found = value orelse return &.{};
    return if (found == .array) found.array.items else &.{};
}

fn stringOf(value: ?std.json.Value) ?[]const u8 {
    const found = value orelse return null;
    return if (found == .string) found.string else null;
}

fn uintOf(value: ?std.json.Value) u64 {
    const found = value orelse return 0;
    return switch (found) {
        .integer => |number| if (number > 0) @intCast(number) else 0,
        .float => |number| if (number > 0) @intFromFloat(number) else 0,
        else => 0,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

const TestMerge = struct {
    arena: std.heap.ArenaAllocator,
    outcome: Outcome,

    fn run(sources: []const []const u8, labels: []const []const u8) !TestMerge {
        var arena: std.heap.ArenaAllocator = .init(std.testing.allocator);
        errdefer arena.deinit();
        const allocator = arena.allocator();
        const roots = try allocator.alloc(std.json.Value, sources.len);
        for (sources, 0..) |source, index| {
            // Parsed trees are left to the arena rather than released
            // individually: everything they own was allocated from it.
            roots[index] = (try std.json.parseFromSlice(std.json.Value, allocator, source, .{})).value;
        }
        // The outcome is built before the arena is copied into the result, so
        // the copied state covers every allocation the merge made.
        const outcome = try merge(allocator, roots, labels);
        return .{ .arena = arena, .outcome = outcome };
    }

    fn deinit(self: *TestMerge) void {
        self.arena.deinit();
        self.* = undefined;
    }

    fn json(self: *TestMerge) ![]const u8 {
        return stringifyValue(self.arena.allocator(), self.outcome.merged.root);
    }
};

fn sceneModel(comptime id: []const u8) []const u8 {
    return "{\"version\":2,\"scenes\":[{\"id\":\"" ++ id ++ "\",\"entryAction\":\"act\"}],\"routes\":[]}";
}

test "merging combines scenes from separately compiled models" {
    var result = try TestMerge.run(&.{ sceneModel("first"), sceneModel("second") }, &.{});
    defer result.deinit();

    const scenes = result.outcome.merged.root.object.get("scenes").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), scenes.len);
    try std.testing.expectEqualStrings("first", scenes[0].object.get("id").?.string);
    try std.testing.expectEqualStrings("second", scenes[1].object.get("id").?.string);
}

test "merging records which input each item came from" {
    var result = try TestMerge.run(&.{ sceneModel("first"), sceneModel("second") }, &.{});
    defer result.deinit();

    const provenance = result.outcome.merged.provenance;
    try std.testing.expectEqual(@as(usize, 2), provenance.len);
    try std.testing.expectEqual(Origin.Kind.scene, provenance[0].kind);
    try std.testing.expectEqualStrings("first", provenance[0].id);
    try std.testing.expectEqual(@as(usize, 0), provenance[0].input);
    try std.testing.expectEqualStrings("second", provenance[1].id);
    try std.testing.expectEqual(@as(usize, 1), provenance[1].input);
}

test "a scene declared twice is a conflict naming both inputs" {
    var result = try TestMerge.run(
        &.{ sceneModel("dup"), sceneModel("dup") },
        &.{ "base", "checkout" },
    );
    defer result.deinit();

    try std.testing.expectEqual(@as(usize, 1), result.outcome.conflicts.len);
    try std.testing.expectEqualStrings(
        "scene \"dup\" is declared by base and checkout",
        result.outcome.conflicts[0],
    );
}

test "unlabelled inputs are named by position" {
    var result = try TestMerge.run(&.{ sceneModel("dup"), sceneModel("dup") }, &.{});
    defer result.deinit();

    try std.testing.expectEqualStrings(
        "scene \"dup\" is declared by model 0 and model 1",
        result.outcome.conflicts[0],
    );
}

test "a route declared twice is a conflict" {
    const route = "{\"version\":2,\"scenes\":[],\"routes\":[{\"id\":\"r\",\"entrySceneId\":\"a\"}]}";
    var result = try TestMerge.run(&.{ route, route }, &.{});
    defer result.deinit();

    try std.testing.expectEqualStrings(
        "route \"r\" is declared by model 0 and model 1",
        result.outcome.conflicts[0],
    );
}

test "every conflict is reported, not just the first" {
    const left =
        "{\"version\":2,\"scenes\":[{\"id\":\"dup\"}]," ++
        "\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[{\"name\":\"shared\",\"type\":\"number\",\"value\":0}]}]}}";
    const right =
        "{\"version\":2,\"scenes\":[{\"id\":\"dup\"}]," ++
        "\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[{\"name\":\"shared\",\"type\":\"bool\",\"value\":false}]}]}}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    try std.testing.expectEqual(@as(usize, 2), result.outcome.conflicts.len);
}

test "a STATE field declared identically twice is agreement" {
    const shared =
        "{\"version\":2,\"scenes\":[{\"id\":\"%\"}]," ++
        "\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"shared\",\"type\":\"number\",\"value\":0}]}]}}";
    const left = comptime blk: {
        var buffer: [shared.len]u8 = shared[0..shared.len].*;
        buffer[std.mem.indexOfScalar(u8, &buffer, '%').?] = 'a';
        break :blk buffer;
    };
    const right = comptime blk: {
        var buffer: [shared.len]u8 = shared[0..shared.len].*;
        buffer[std.mem.indexOfScalar(u8, &buffer, '%').?] = 'b';
        break :blk buffer;
    };
    var result = try TestMerge.run(&.{ &left, &right }, &.{});
    defer result.deinit();

    const namespaces = result.outcome.merged.root.object.get("state").?.object.get("namespaces").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), namespaces.len);
    const fields = namespaces[0].object.get("fields").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), fields.len);
    try std.testing.expectEqualStrings("shared", fields[0].object.get("name").?.string);
}

test "a STATE field declared differently is a conflict naming both declarations" {
    const left =
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"shared\",\"type\":\"number\",\"value\":0}]}]}}";
    const right =
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"shared\",\"type\":\"str\",\"value\":\"\"}]}]}}";
    var result = try TestMerge.run(&.{ left, right }, &.{ "base", "extra" });
    defer result.deinit();

    try std.testing.expectEqualStrings(
        "STATE field \"app.shared\" is declared as str=\"\" by extra and as number=0 by base",
        result.outcome.conflicts[0],
    );
}

test "namespaces accumulate fields across inputs" {
    const left =
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"shared\",\"type\":\"number\",\"value\":0}]}]}}";
    const right =
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"shared\",\"type\":\"number\",\"value\":0}," ++
        "{\"name\":\"extra\",\"type\":\"str\",\"value\":\"\"}]}]}}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    const namespaces = result.outcome.merged.root.object.get("state").?.object.get("namespaces").?.array.items;
    const fields = namespaces[0].object.get("fields").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), fields.len);
    try std.testing.expectEqualStrings("shared", fields[0].object.get("name").?.string);
    try std.testing.expectEqualStrings("extra", fields[1].object.get("name").?.string);
}

test "a namespace that declares no fields is kept" {
    const left = "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[]}]}}";
    const right =
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"app\",\"fields\":[" ++
        "{\"name\":\"one\",\"type\":\"number\",\"value\":0}]}]}}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    const namespaces = result.outcome.merged.root.object.get("state").?.object.get("namespaces").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), namespaces.len);
    try std.testing.expectEqualStrings("app", namespaces[0].object.get("name").?.string);
    const fields = namespaces[0].object.get("fields").?.array.items;
    try std.testing.expectEqual(@as(usize, 1), fields.len);
    try std.testing.expectEqualStrings("one", fields[0].object.get("name").?.string);
}

test "a model with no STATE stays without one" {
    var result = try TestMerge.run(&.{ sceneModel("a"), sceneModel("b") }, &.{});
    defer result.deinit();

    try std.testing.expect(result.outcome.merged.root.object.get("state") == null);
}

test "type declarations union and an identical redeclaration is agreement" {
    const left = "{\"version\":2,\"typeDecls\":[{\"name\":\"Status\",\"type\":{\"literal\":\"ok\"}}]}";
    const right =
        "{\"version\":2,\"typeDecls\":[{\"name\":\"Status\",\"type\":{\"literal\":\"ok\"}}," ++
        "{\"name\":\"Code\",\"type\":{\"literal\":1}}]}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    const decls = result.outcome.merged.root.object.get("typeDecls").?.array.items;
    try std.testing.expectEqual(@as(usize, 2), decls.len);
    try std.testing.expectEqualStrings("Status", decls[0].object.get("name").?.string);
    try std.testing.expectEqualStrings("Code", decls[1].object.get("name").?.string);
}

test "a type declared differently is a conflict" {
    const left = "{\"version\":2,\"typeDecls\":[{\"name\":\"Status\",\"type\":{\"literal\":\"ok\"}}]}";
    const right = "{\"version\":2,\"typeDecls\":[{\"name\":\"Status\",\"type\":{\"literal\":\"no\"}}]}";
    var result = try TestMerge.run(&.{ left, right }, &.{ "base", "extra" });
    defer result.deinit();

    try std.testing.expectEqualStrings(
        "type \"Status\" is declared differently by base and extra",
        result.outcome.conflicts[0],
    );
}

test "the version window narrows to satisfy every input" {
    const left = "{\"version\":2,\"minVersion\":1,\"maxVersion\":5}";
    const right = "{\"version\":2,\"minVersion\":2,\"maxVersion\":4}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    const root = result.outcome.merged.root.object;
    try std.testing.expectEqual(@as(i64, 2), root.get("minVersion").?.integer);
    try std.testing.expectEqual(@as(i64, 4), root.get("maxVersion").?.integer);
}

test "an unset ceiling does not narrow the window" {
    const left = "{\"version\":2,\"maxVersion\":0}";
    const right = "{\"version\":2,\"maxVersion\":4}";
    var result = try TestMerge.run(&.{ left, right }, &.{});
    defer result.deinit();

    try std.testing.expectEqual(
        @as(i64, 4),
        result.outcome.merged.root.object.get("maxVersion").?.integer,
    );
}

test "inputs compiled at different schema versions conflict" {
    var result = try TestMerge.run(&.{ "{\"version\":2}", "{\"version\":1}" }, &.{});
    defer result.deinit();

    try std.testing.expectEqualStrings(
        "model 1 is version 1, model 0 is version 2",
        result.outcome.conflicts[0],
    );
}

test "merging nothing is a conflict rather than an empty model" {
    var result = try TestMerge.run(&.{}, &.{});
    defer result.deinit();

    try std.testing.expectEqual(@as(usize, 1), result.outcome.conflicts.len);
    try std.testing.expectEqualStrings("no models to merge", result.outcome.conflicts[0]);
}

test "fields the first input did not declare keep their position in the root" {
    var result = try TestMerge.run(&.{ sceneModel("a"), sceneModel("b") }, &.{});
    defer result.deinit();

    // "version" was already present and stays first; the rest append in the
    // order the merged root writes them.
    const json = try result.json();
    try std.testing.expect(std.mem.startsWith(u8, json, "{\"version\":2,\"scenes\":"));
}
