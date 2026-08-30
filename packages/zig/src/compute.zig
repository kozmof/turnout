const std = @import("std");

pub const LoadError = error{
    OutOfMemory,
    InvalidJson,
    RootMustBeObject,
    MissingRoot,
    MissingProgram,
    InvalidProgram,
    InvalidBinding,
    DuplicateBinding,
    MissingRootBinding,
    InvalidExpression,
};

pub const LoadedCompute = struct {
    parsed: std.json.Parsed(std.json.Value),

    pub fn init(allocator: std.mem.Allocator, bytes: []const u8) LoadError!LoadedCompute {
        const parsed = std.json.parseFromSlice(std.json.Value, allocator, bytes, .{}) catch
            return error.InvalidJson;
        errdefer parsed.deinit();
        try validate(parsed.value, allocator);
        return .{ .parsed = parsed };
    }

    pub fn deinit(self: *LoadedCompute) void {
        self.parsed.deinit();
        self.* = undefined;
    }

    pub fn rootName(self: *const LoadedCompute) []const u8 {
        return self.parsed.value.object.get("root").?.string;
    }

    pub fn bindings(self: *const LoadedCompute) []const std.json.Value {
        return self.parsed.value.object.get("prog").?.object.get("bindings").?.array.items;
    }
};

pub fn validate(compute: std.json.Value, allocator: std.mem.Allocator) LoadError!void {
    if (compute != .object) return error.RootMustBeObject;
    const root = compute.object.get("root") orelse return error.MissingRoot;
    if (root != .string or root.string.len == 0) return error.MissingRoot;
    const prog = compute.object.get("prog") orelse return error.MissingProgram;
    if (prog != .object) return error.InvalidProgram;
    const bindings_value = prog.object.get("bindings") orelse return error.InvalidProgram;
    if (bindings_value != .array) return error.InvalidProgram;

    var names = std.StringHashMapUnmanaged(void).empty;
    defer names.deinit(allocator);
    var found_root = false;
    for (bindings_value.array.items) |binding| {
        if (binding != .object) return error.InvalidBinding;
        const name = binding.object.get("name") orelse return error.InvalidBinding;
        const field_type = binding.object.get("type") orelse return error.InvalidBinding;
        if (name != .string or name.string.len == 0 or field_type != .string or field_type.string.len == 0)
            return error.InvalidBinding;
        const entry = try names.getOrPut(allocator, name.string);
        if (entry.found_existing) return error.DuplicateBinding;
        if (std.mem.eql(u8, name.string, root.string)) found_root = true;

        const has_value = binding.object.contains("value");
        const has_expr = binding.object.contains("expr");
        if (has_value == has_expr) return error.InvalidBinding;
        if (has_expr) try validateExpression(binding.object.get("expr").?);
    }
    if (!found_root) return error.MissingRootBinding;
}

fn validateExpression(expression: std.json.Value) LoadError!void {
    if (expression != .object) return error.InvalidExpression;
    var variants: usize = 0;
    if (expression.object.contains("combine")) variants += 1;
    if (expression.object.contains("pipe")) variants += 1;
    if (expression.object.contains("cond")) variants += 1;
    if (variants != 1) return error.InvalidExpression;
}

test "compute loader retains declaration order" {
    const fixture =
        \\{"root":"result","prog":{"name":"run","bindings":[
        \\  {"name":"input","type":"number","value":1},
        \\  {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[]}}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    try std.testing.expectEqualStrings("result", loaded.rootName());
    try std.testing.expectEqualStrings("input", loaded.bindings()[0].object.get("name").?.string);
    try std.testing.expectEqualStrings("result", loaded.bindings()[1].object.get("name").?.string);
}

test "compute validation rejects malformed binding graphs" {
    try std.testing.expectError(error.MissingRootBinding, LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"missing\",\"prog\":{\"bindings\":[{\"name\":\"x\",\"type\":\"number\",\"value\":1}]}}",
    ));
    try std.testing.expectError(error.DuplicateBinding, LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"x\",\"prog\":{\"bindings\":[{\"name\":\"x\",\"type\":\"number\",\"value\":1},{\"name\":\"x\",\"type\":\"number\",\"value\":2}]}}",
    ));
    try std.testing.expectError(error.InvalidBinding, LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"x\",\"prog\":{\"bindings\":[{\"name\":\"x\",\"type\":\"number\",\"value\":1,\"expr\":{\"combine\":{}}}]}}",
    ));
    try std.testing.expectError(error.InvalidExpression, LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"x\",\"prog\":{\"bindings\":[{\"name\":\"x\",\"type\":\"number\",\"expr\":{\"combine\":{},\"cond\":{}}}]}}",
    ));
}
