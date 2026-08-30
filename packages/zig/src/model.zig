const std = @import("std");

pub const current_version: u32 = 1;
pub const Limits = struct { max_model_bytes: usize = 16 * 1024 * 1024 };
pub const ValidationError = error{
    ModelTooLarge,
    InvalidJson,
    RootMustBeObject,
    UnsupportedVersion,
    RuntimeTooOld,
    RuntimeTooNew,
    CompilerMetadata,
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
    const root = parsed.value.object;
    const names = [_][]const u8{ "annotations", "sourcePos", "sigils", "extExpr", "declaredType" };
    for (names) |name| if (root.contains(name)) return error.CompilerMetadata;
    const version = try uintField(root, "version");
    if (version != current_version) return error.UnsupportedVersion;
    const min = try optionalUintField(root, "minVersion");
    const max = try optionalUintField(root, "maxVersion");
    if (min > current_version) return error.RuntimeTooOld;
    if (max != 0 and max < current_version) return error.RuntimeTooNew;
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

test "runtime projection accepts version one and unknown fields" {
    try validateJson(std.testing.allocator, "{\"version\":1,\"future\":true}", .{});
}

test "runtime projection enforces version range and metadata boundary" {
    try std.testing.expectError(error.RuntimeTooOld, validateJson(std.testing.allocator, "{\"version\":1,\"minVersion\":2}", .{}));
    try std.testing.expectError(error.CompilerMetadata, validateJson(std.testing.allocator, "{\"version\":1,\"annotations\":{}}", .{}));
}
