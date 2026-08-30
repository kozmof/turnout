const std = @import("std");
const fn_aliases = @import("generated/fn_aliases.zig");
const preset = @import("preset.zig");
const value = @import("value.zig");

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

    pub fn execute(self: *const LoadedCompute, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
        var values: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty;
        defer deinitValues(&values, allocator);

        for (self.bindings()) |binding| {
            const object = binding.object;
            const name = object.get("name").?.string;
            var result = if (object.get("value")) |literal|
                try ownedJsonValue(literal, allocator)
            else
                try executeExpression(object.get("expr").?, &values, allocator);
            values.put(allocator, name, result) catch |err| {
                result.deinit(allocator);
                return err;
            };
        }

        const root = values.getPtr(self.rootName()) orelse return error.MissingRootBinding;
        return value.build(root.value, root.tags, allocator);
    }
};

fn deinitValues(values: *std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue), allocator: std.mem.Allocator) void {
    for (values.values()) |*item| item.deinit(allocator);
    values.deinit(allocator);
}

fn ownedJsonValue(json: std.json.Value, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
    var converted = try value.fromJson(allocator, json);
    errdefer value.deinitValue(&converted, allocator);
    return .{ .value = converted, .tags = try allocator.alloc([]const u8, 0) };
}

fn executeExpression(
    expression: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (expression.object.get("combine")) |combine| return executeCombine(combine, values, allocator);
    if (expression.object.contains("pipe")) return error.UnsupportedPipe;
    return error.UnsupportedConditional;
}

fn executeCombine(
    combine: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (combine != .object) return error.InvalidExpression;
    const fn_value = combine.object.get("fn") orelse return error.InvalidExpression;
    const args_value = combine.object.get("args") orelse return error.InvalidExpression;
    if (fn_value != .string or args_value != .array) return error.InvalidExpression;

    var owned_args = std.ArrayList(value.OwnedTaggedValue).empty;
    defer {
        for (owned_args.items) |*arg| arg.deinit(allocator);
        owned_args.deinit(allocator);
    }
    var args = std.ArrayList(value.TaggedValue).empty;
    defer args.deinit(allocator);
    for (args_value.array.items) |arg| {
        if (arg != .object) return error.InvalidArgument;
        if (arg.object.get("ref")) |reference| {
            if (reference != .string) return error.InvalidArgument;
            const resolved = values.get(reference.string) orelse return error.MissingReference;
            try args.append(allocator, resolved.borrowed());
        } else if (arg.object.get("lit")) |literal| {
            try owned_args.ensureUnusedCapacity(allocator, 1);
            owned_args.appendAssumeCapacity(try ownedJsonValue(literal, allocator));
            try args.append(allocator, owned_args.items[owned_args.items.len - 1].borrowed());
        } else if (arg.object.get("transform")) |transform| {
            try owned_args.ensureUnusedCapacity(allocator, 1);
            owned_args.appendAssumeCapacity(try executeTransform(transform, values, allocator));
            try args.append(allocator, owned_args.items[owned_args.items.len - 1].borrowed());
        } else return error.UnsupportedArgument;
    }
    const function_name = fn_aliases.resolve(fn_value.string) orelse fn_value.string;
    return preset.call(function_name, args.items, allocator);
}

fn executeTransform(
    transform: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (transform != .object) return error.InvalidArgument;
    const reference = transform.object.get("ref") orelse return error.InvalidArgument;
    const functions = transform.object.get("fn") orelse return error.InvalidArgument;
    if (reference != .string or functions != .array) return error.InvalidArgument;
    const source = values.get(reference.string) orelse return error.MissingReference;
    var current = try value.build(source.value, source.tags, allocator);
    errdefer current.deinit(allocator);
    for (functions.array.items) |function| {
        if (function != .string) return error.InvalidArgument;
        const next = try preset.call(function.string, &.{current.borrowed()}, allocator);
        current.deinit(allocator);
        current = next;
    }
    return current;
}

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

test "compute executes bindings in declaration order and resolves root" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"input","type":"number","value":2},
        \\  {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"transform":{"ref":"input","fn":["transformFnNumber::negate"]}},{"lit":5}]}}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    var result = try loaded.execute(std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 3), result.value.number);
}

test "compute rejects forward references during ordered execution" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"later"},{"lit":1}]}}},
        \\  {"name":"later","type":"number","value":2}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    try std.testing.expectError(error.MissingReference, loaded.execute(std.testing.allocator));
}
