const std = @import("std");

pub const current_version: u32 = 2;
pub const Limits = struct {
    max_model_bytes: usize = 16 * 1024 * 1024,
    max_nesting: usize = 128,
};
pub const ValidationError = error{
    ModelTooLarge,
    ModelTooDeep,
    InvalidJson,
    RootMustBeObject,
    UnsupportedVersion,
    RuntimeTooOld,
    RuntimeTooNew,
    CompilerMetadata,
};

pub const RuntimeModel = struct {
    parsed: std.json.Parsed(std.json.Value),

    pub fn init(allocator: std.mem.Allocator, bytes: []const u8, limits: Limits) ValidationError!RuntimeModel {
        try validateJson(allocator, bytes, limits);
        const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{
            .max_value_len = limits.max_model_bytes,
        }) catch return error.InvalidJson;
        return .{ .parsed = parsed };
    }

    pub fn deinit(self: *RuntimeModel) void {
        self.parsed.deinit();
        self.* = undefined;
    }

    pub fn root(self: *const RuntimeModel) std.json.ObjectMap {
        return self.parsed.value.object;
    }
};

/// Validate the JSON-first runtime projection. Unknown runtime fields are
/// ignored for forward compatibility; known compiler-only fields are rejected.
pub fn validateJson(allocator: std.mem.Allocator, bytes: []const u8, limits: Limits) ValidationError!void {
    if (bytes.len > limits.max_model_bytes) return error.ModelTooLarge;
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{
        .max_value_len = limits.max_model_bytes,
    }) catch return error.InvalidJson;
    defer parsed.deinit();
    if (parsed.value != .object) return error.RootMustBeObject;
    try validateNesting(parsed.value, 0, limits.max_nesting);
    const root = parsed.value.object;
    try rejectCompilerMetadata(root);
    const version = try uintField(root, "version");
    if (version != current_version) return error.UnsupportedVersion;
    const min = try optionalUintField(root, "minVersion");
    const max = try optionalUintField(root, "maxVersion");
    if (min > current_version) return error.RuntimeTooOld;
    if (max != 0 and max < current_version) return error.RuntimeTooNew;
}

fn validateNesting(value: std.json.Value, depth: usize, maximum: usize) ValidationError!void {
    if (depth > maximum) return error.ModelTooDeep;
    switch (value) {
        .object => |object| {
            var iterator = object.iterator();
            while (iterator.next()) |entry| try validateNesting(entry.value_ptr.*, depth + 1, maximum);
        },
        .array => |array| for (array.items) |item| try validateNesting(item, depth + 1, maximum),
        else => {},
    }
}

fn rejectCompilerMetadata(root: std.json.ObjectMap) ValidationError!void {
    if (root.contains("annotations")) return error.CompilerMetadata;
    if (root.get("typeDecls")) |decls| {
        if (decls == .array) for (decls.array.items) |decl| {
            if (decl == .object and decl.object.contains("sourcePos")) return error.CompilerMetadata;
        };
    }
    const scenes = root.get("scenes") orelse return;
    if (scenes != .array) return;
    for (scenes.array.items) |scene_value| {
        if (scene_value != .object) continue;
        const scene = scene_value.object;
        if (scene.get("view")) |view| {
            if (view == .object and
                (view.object.contains("nodes") or
                    view.object.contains("edges") or
                    view.object.contains("sourcePos")))
                return error.CompilerMetadata;
        }
        const actions = scene.get("actions") orelse continue;
        if (actions != .array) continue;
        for (actions.array.items) |action_value| {
            if (action_value != .object) continue;
            const action = action_value.object;
            if (action.get("compute")) |compute| try rejectComputeMetadata(compute);
            const next_rules = action.get("next") orelse continue;
            if (next_rules != .array) continue;
            for (next_rules.array.items) |next_rule| {
                if (next_rule != .object) continue;
                if (next_rule.object.get("compute")) |compute| try rejectComputeMetadata(compute);
            }
        }
    }
}

fn rejectComputeMetadata(compute: std.json.Value) ValidationError!void {
    if (compute != .object) return;
    const prog = compute.object.get("prog") orelse return;
    if (prog != .object) return;
    if (prog.object.contains("sigils")) return error.CompilerMetadata;
    const bindings = prog.object.get("bindings") orelse return;
    if (bindings != .array) return;
    for (bindings.array.items) |binding| {
        if (binding == .object and
            (binding.object.contains("extExpr") or
                binding.object.contains("sourcePos") or
                binding.object.contains("declaredType")))
            return error.CompilerMetadata;
    }
}

fn uintField(root: std.json.ObjectMap, name: []const u8) ValidationError!u32 {
    const value = root.get(name) orelse return error.UnsupportedVersion;
    if (value != .integer or value.integer < 0 or value.integer > std.math.maxInt(u32))
        return error.UnsupportedVersion;
    return @intCast(value.integer);
}

fn optionalUintField(root: std.json.ObjectMap, name: []const u8) ValidationError!u32 {
    const value = root.get(name) orelse return 0;
    if (value != .integer or value.integer < 0 or value.integer > std.math.maxInt(u32))
        return error.UnsupportedVersion;
    return @intCast(value.integer);
}

test "runtime projection accepts converter version and unknown fields" {
    try validateJson(std.testing.allocator, "{\"version\":2,\"minVersion\":2,\"maxVersion\":2,\"future\":true}", .{});
}

test "runtime projection enforces version range and metadata boundary" {
    try std.testing.expectError(error.RuntimeTooOld, validateJson(std.testing.allocator, "{\"version\":2,\"minVersion\":3}", .{}));
    try std.testing.expectError(error.RuntimeTooNew, validateJson(std.testing.allocator, "{\"version\":2,\"maxVersion\":1}", .{}));
    try std.testing.expectError(error.CompilerMetadata, validateJson(std.testing.allocator, "{\"version\":2,\"annotations\":{}}", .{}));
}

test "runtime projection rejects nested compiler metadata" {
    try std.testing.expectError(
        error.CompilerMetadata,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"actions\":[{\"compute\":{\"prog\":{\"sigils\":{}}}}]}]}",
            .{},
        ),
    );
    try std.testing.expectError(
        error.CompilerMetadata,
        validateJson(
            std.testing.allocator,
            "{\"version\":2,\"scenes\":[{\"view\":{\"nodes\":[]}}]}",
            .{},
        ),
    );
}

test "runtime projection permits metadata-like user record keys" {
    try validateJson(
        std.testing.allocator,
        "{\"version\":2,\"state\":{\"namespaces\":[{\"name\":\"x\",\"fields\":[{\"name\":\"r\",\"type\":\"rec<str, str>\",\"value\":{\"nodes\":\"user data\",\"sourcePos\":\"also data\"}}]}]}}",
        .{},
    );
}

test "decoded runtime model retains representative full-schema JSON" {
    const fixture =
        \\{
        \\  "version": 2,
        \\  "minVersion": 2,
        \\  "maxVersion": 2,
        \\  "state": {
        \\    "namespaces": [{
        \\      "name": "app",
        \\      "fields": [{
        \\        "name": "payload",
        \\        "type": "rec<str, arr<number>>",
        \\        "value": {"scores": [1, 2.5], "missing": null}
        \\      }]
        \\    }]
        \\  },
        \\  "scenes": [{
        \\    "id": "main",
        \\    "entryAction": "start",
        \\    "actions": [{
        \\      "id": "start",
        \\      "compute": {
        \\        "root": "result",
        \\        "prog": {
        \\          "name": "run",
        \\          "bindings": [
        \\            {"name": "input", "type": "number", "value": 1},
        \\            {"name": "result", "type": "number", "expr": {
        \\              "combine": {"fn": "add", "args": [{"ref": "input"}, {"lit": 2}]}
        \\            }}
        \\          ]
        \\        }
        \\      },
        \\      "prepare": [{"binding": "input", "fromState": "app.count"}],
        \\      "merge": [{"binding": "result", "toState": "app.count"}],
        \\      "publish": ["saved"],
        \\      "next": []
        \\    }]
        \\  }],
        \\  "routes": [{"id": "route", "entrySceneId": "main", "match": [{"patterns": ["_"], "target": "main"}]}]
        \\}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    try std.testing.expectEqual(@as(i64, 2), model.root().get("version").?.integer);
    try std.testing.expectEqual(@as(usize, 1), model.root().get("scenes").?.array.items.len);
}

test "runtime projection enforces nesting limit" {
    try std.testing.expectError(
        error.ModelTooDeep,
        validateJson(std.testing.allocator, "{\"version\":2,\"a\":{\"b\":{\"c\":true}}}", .{ .max_nesting = 2 }),
    );
}

test "JSON-first decoding covers absent optional and reserved field names" {
    const fixture =
        \\{
        \\  "version": 2,
        \\  "scenes": [{
        \\    "id": "main",
        \\    "entryAction": "done",
        \\    "nextPolicy": "reserved-unknown-field",
        \\    "actions": [{"id": "done", "publish": [], "next": []}]
        \\  }],
        \\  "routes": [{"id": "route", "match": []}]
        \\}
    ;
    var model = try RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const scene = model.root().get("scenes").?.array.items[0].object;
    try std.testing.expect(scene.get("view") == null);
    try std.testing.expectEqualStrings("reserved-unknown-field", scene.get("nextPolicy").?.string);
    const route = model.root().get("routes").?.array.items[0].object;
    try std.testing.expect(route.get("entrySceneId") == null);
}
