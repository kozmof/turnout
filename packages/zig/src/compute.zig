const std = @import("std");
const fn_aliases = @import("generated/fn_aliases.zig");
const preset = @import("preset.zig");
const value = @import("value.zig");

pub const max_program_bindings: usize = 50_000;
pub const max_program_expression_nodes: usize = 50_000;

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
    ProgramTooLarge,
    ProgramTooComplex,
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
        const root = self.parsed.value.object.get("root") orelse return "";
        return root.string;
    }

    pub fn bindings(self: *const LoadedCompute) []const std.json.Value {
        return self.parsed.value.object.get("prog").?.object.get("bindings").?.array.items;
    }

    pub fn execute(self: *const LoadedCompute, allocator: std.mem.Allocator) !value.OwnedTaggedValue {
        const inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
        return self.executeWithInputs(&inputs, allocator);
    }

    pub fn executeWithInputs(
        self: *const LoadedCompute,
        inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
        allocator: std.mem.Allocator,
    ) !value.OwnedTaggedValue {
        return executeJson(self.parsed.value, inputs, allocator);
    }
};

pub fn executeJson(
    compute: std.json.Value,
    inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    try validate(compute, allocator);
    var values: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty;
    defer deinitValues(&values, allocator);
    const bindings = compute.object.get("prog").?.object.get("bindings").?.array.items;
    for (bindings) |binding| {
        const object = binding.object;
        const name = object.get("name").?.string;
        var result = if (object.get("expr")) |expression|
            try executeExpression(expression, &values, allocator)
        else if (inputs.get(name)) |input|
            try value.build(input.value, input.tags, allocator)
        else if (object.get("value")) |literal|
            try ownedJsonValue(literal, allocator)
        else
            return error.MissingBindingValue;
        values.put(allocator, name, result) catch |err| {
            result.deinit(allocator);
            return err;
        };
    }
    const root_name = if (compute.object.get("root")) |root| root.string else "";
    if (root_name.len == 0) return value.buildNull(.missing, &.{}, allocator);
    const root = values.getPtr(root_name) orelse return error.MissingRootBinding;
    return value.build(root.value, root.tags, allocator);
}

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
    if (expression.object.get("pipe")) |pipe| return executePipe(pipe, values, allocator);
    return executeConditional(expression.object.get("cond").?, values, allocator);
}

fn executePipe(
    pipe: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (pipe != .object) return error.InvalidExpression;
    const params_value = pipe.object.get("params") orelse return error.InvalidExpression;
    const steps_value = pipe.object.get("steps") orelse return error.InvalidExpression;
    if (params_value != .array or steps_value != .array) return error.InvalidExpression;
    if (steps_value.array.items.len == 0) return error.EmptyPipe;

    var params: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty;
    defer deinitValues(&params, allocator);
    for (params_value.array.items) |param| {
        if (param != .object) return error.InvalidArgument;
        const name = param.object.get("paramName") orelse return error.InvalidArgument;
        const source = param.object.get("sourceIdent") orelse return error.InvalidArgument;
        if (name != .string or name.string.len == 0 or source != .string) return error.InvalidArgument;
        if (params.contains(name.string)) return error.DuplicateParameter;
        const source_value = values.get(source.string) orelse return error.MissingReference;
        var cloned = try value.build(source_value.value, source_value.tags, allocator);
        params.put(allocator, name.string, cloned) catch |err| {
            cloned.deinit(allocator);
            return err;
        };
    }

    var step_results = std.ArrayList(value.OwnedTaggedValue).empty;
    defer {
        for (step_results.items) |*result| result.deinit(allocator);
        step_results.deinit(allocator);
    }
    for (steps_value.array.items) |step| {
        if (step != .object) return error.InvalidExpression;
        const fn_value = step.object.get("fn") orelse return error.InvalidExpression;
        const args_value = step.object.get("args") orelse return error.InvalidExpression;
        if (fn_value != .string or args_value != .array) return error.InvalidExpression;
        var owned_args = std.ArrayList(value.OwnedTaggedValue).empty;
        defer {
            for (owned_args.items) |*arg| arg.deinit(allocator);
            owned_args.deinit(allocator);
        }
        var args = std.ArrayList(value.TaggedValue).empty;
        defer args.deinit(allocator);
        for (args_value.array.items) |arg| {
            try owned_args.ensureUnusedCapacity(allocator, 1);
            owned_args.appendAssumeCapacity(try resolvePipeArgument(arg, &params, values, step_results.items, allocator));
            try args.append(allocator, owned_args.items[owned_args.items.len - 1].borrowed());
        }
        const function_name = fn_aliases.resolve(fn_value.string) orelse fn_value.string;
        try step_results.ensureUnusedCapacity(allocator, 1);
        step_results.appendAssumeCapacity(try preset.call(function_name, args.items, allocator));
    }
    const final = &step_results.items[step_results.items.len - 1];
    return value.build(final.value, final.tags, allocator);
}

fn resolvePipeArgument(
    arg: std.json.Value,
    params: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    step_results: []const value.OwnedTaggedValue,
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (arg != .object) return error.InvalidArgument;
    var variants: usize = 0;
    inline for (.{ "ref", "funcRef", "lit", "stepRef", "transform" }) |name| {
        if (arg.object.contains(name)) variants += 1;
    }
    if (variants != 1) return error.InvalidArgument;
    if (arg.object.get("stepRef")) |step_ref| {
        if (step_ref != .integer or step_ref.integer < 0) return error.InvalidStepReference;
        const index: usize = @intCast(step_ref.integer);
        if (index >= step_results.len) return error.InvalidStepReference;
        return value.build(step_results[index].value, step_results[index].tags, allocator);
    }
    if (arg.object.get("ref") orelse arg.object.get("funcRef")) |reference| {
        if (reference != .string) return error.InvalidArgument;
        const resolved = params.get(reference.string) orelse values.get(reference.string) orelse return error.MissingReference;
        return value.build(resolved.value, resolved.tags, allocator);
    }
    if (arg.object.get("lit")) |literal| return ownedJsonValue(literal, allocator);
    if (arg.object.get("transform")) |transform| {
        if (transform != .object) return error.InvalidArgument;
        const reference = transform.object.get("ref") orelse return error.InvalidArgument;
        const functions = transform.object.get("fn") orelse return error.InvalidArgument;
        if (reference != .string) return error.InvalidArgument;
        const source = params.get(reference.string) orelse values.get(reference.string) orelse return error.MissingReference;
        return applyTransforms(source, functions, allocator);
    }
    return error.UnsupportedArgument;
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
        try owned_args.ensureUnusedCapacity(allocator, 1);
        owned_args.appendAssumeCapacity(try resolveArgument(arg, values, allocator, true));
        try args.append(allocator, owned_args.items[owned_args.items.len - 1].borrowed());
    }
    const function_name = fn_aliases.resolve(fn_value.string) orelse fn_value.string;
    return preset.call(function_name, args.items, allocator);
}

fn executeConditional(
    conditional: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (conditional != .object) return error.InvalidExpression;
    const condition_arg = conditional.object.get("condition") orelse return error.InvalidExpression;
    const then_arg = conditional.object.get("then") orelse return error.InvalidExpression;
    const else_arg = conditional.object.get("elseBranch") orelse return error.InvalidExpression;
    var condition = try resolveArgument(condition_arg, values, allocator, false);
    defer condition.deinit(allocator);
    if (condition.value != .boolean) return error.ConditionTypeMismatch;
    return resolveArgument(if (condition.value.boolean) then_arg else else_arg, values, allocator, false);
}

fn resolveArgument(
    arg: std.json.Value,
    values: *const std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    allocator: std.mem.Allocator,
    allow_transform: bool,
) !value.OwnedTaggedValue {
    if (arg != .object) return error.InvalidArgument;
    var variants: usize = 0;
    inline for (.{ "ref", "funcRef", "lit", "stepRef", "transform" }) |name| {
        if (arg.object.contains(name)) variants += 1;
    }
    if (variants != 1) return error.InvalidArgument;
    if (arg.object.get("ref") orelse arg.object.get("funcRef")) |reference| {
        if (reference != .string) return error.InvalidArgument;
        const resolved = values.get(reference.string) orelse return error.MissingReference;
        return value.build(resolved.value, resolved.tags, allocator);
    }
    if (arg.object.get("lit")) |literal| return ownedJsonValue(literal, allocator);
    if (arg.object.get("transform")) |transform| {
        if (!allow_transform) return error.UnsupportedArgument;
        return executeTransform(transform, values, allocator);
    }
    return error.UnsupportedArgument;
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
    return applyTransforms(source, functions, allocator);
}

fn applyTransforms(
    source: value.OwnedTaggedValue,
    functions: std.json.Value,
    allocator: std.mem.Allocator,
) !value.OwnedTaggedValue {
    if (functions != .array) return error.InvalidArgument;
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
    const root = compute.object.get("root") orelse std.json.Value{ .string = "" };
    if (root != .string) return error.MissingRoot;
    const prog = compute.object.get("prog") orelse return error.MissingProgram;
    return validateProgram(prog, root.string, allocator);
}

pub fn validateProgram(prog: std.json.Value, output_name: []const u8, allocator: std.mem.Allocator) LoadError!void {
    return validateProgramWithLimit(prog, output_name, allocator, max_program_bindings);
}

pub fn validateProgramWithLimit(
    prog: std.json.Value,
    output_name: []const u8,
    allocator: std.mem.Allocator,
    max_bindings: usize,
) LoadError!void {
    return validateProgramWithLimits(prog, output_name, allocator, max_bindings, max_program_expression_nodes);
}

pub fn validateProgramWithLimits(
    prog: std.json.Value,
    output_name: []const u8,
    allocator: std.mem.Allocator,
    max_bindings: usize,
    max_expression_nodes: usize,
) LoadError!void {
    if (prog != .object) return error.InvalidProgram;
    const bindings_value = prog.object.get("bindings") orelse return error.InvalidProgram;
    if (bindings_value != .array) return error.InvalidProgram;
    if (bindings_value.array.items.len > max_bindings) return error.ProgramTooLarge;

    var names = std.StringHashMapUnmanaged(void).empty;
    defer names.deinit(allocator);
    var found_root = false;
    var expression_nodes: usize = 0;
    for (bindings_value.array.items) |binding| {
        if (binding != .object) return error.InvalidBinding;
        const name = binding.object.get("name") orelse return error.InvalidBinding;
        const field_type = binding.object.get("type") orelse return error.InvalidBinding;
        if (name != .string or name.string.len == 0 or field_type != .string or field_type.string.len == 0)
            return error.InvalidBinding;
        const entry = try names.getOrPut(allocator, name.string);
        if (entry.found_existing) return error.DuplicateBinding;
        if (std.mem.eql(u8, name.string, output_name)) found_root = true;

        const has_value = binding.object.contains("value");
        const has_expr = binding.object.contains("expr");
        if (has_value and has_expr) return error.InvalidBinding;
        if (has_expr) {
            const expression = binding.object.get("expr").?;
            try validateExpression(expression);
            expression_nodes = try countJsonNodes(expression, expression_nodes, max_expression_nodes, allocator);
        }
    }
    if (output_name.len > 0 and !found_root) return error.MissingRootBinding;
}

fn countJsonNodes(root: std.json.Value, initial: usize, maximum: usize, allocator: std.mem.Allocator) LoadError!usize {
    var count = initial;
    var pending = std.ArrayList(std.json.Value).empty;
    defer pending.deinit(allocator);
    try pending.append(allocator, root);
    while (pending.pop()) |current| {
        if (count >= maximum) return error.ProgramTooComplex;
        count += 1;
        switch (current) {
            .array => |array| try pending.appendSlice(allocator, array.items),
            .object => |object| {
                var iterator = object.iterator();
                while (iterator.next()) |entry| try pending.append(allocator, entry.value_ptr.*);
            },
            else => {},
        }
    }
    return count;
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

test "compute validation enforces the flattened binding budget" {
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"bindings\":[{\"name\":\"a\",\"type\":\"number\",\"value\":1},{\"name\":\"b\",\"type\":\"number\",\"value\":2}]}",
        .{},
    );
    defer parsed.deinit();
    try std.testing.expectError(
        error.ProgramTooLarge,
        validateProgramWithLimit(parsed.value, "a", std.testing.allocator, 1),
    );
    try validateProgramWithLimit(parsed.value, "a", std.testing.allocator, 2);
}

test "compute validation iteratively enforces expression complexity" {
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        std.testing.allocator,
        "{\"bindings\":[{\"name\":\"a\",\"type\":\"number\",\"expr\":{\"combine\":{\"fn\":\"add\",\"args\":[{\"lit\":1},{\"lit\":2}]}}}]}",
        .{},
    );
    defer parsed.deinit();
    try std.testing.expectError(
        error.ProgramTooComplex,
        validateProgramWithLimits(parsed.value, "a", std.testing.allocator, 1, 3),
    );
    try validateProgramWithLimits(parsed.value, "a", std.testing.allocator, 1, 16);
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

test "compute conditionals resolve only the selected branch" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"enabled","type":"bool","value":true},
        \\  {"name":"chosen","type":"str","value":"yes"},
        \\  {"name":"result","type":"str","expr":{"cond":{"condition":{"ref":"enabled"},"then":{"funcRef":"chosen"},"elseBranch":{"ref":"missing"}}}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    var result = try loaded.execute(std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqualStrings("yes", result.value.string);
}

test "compute conditionals require boolean conditions" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"condition","type":"number","value":1},
        \\  {"name":"result","type":"number","expr":{"cond":{"condition":{"ref":"condition"},"then":{"lit":2},"elseBranch":{"lit":3}}}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    try std.testing.expectError(error.ConditionTypeMismatch, loaded.execute(std.testing.allocator));
}

test "compute pipes map parameters and resolve prior steps" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"input","type":"number","value":2},
        \\  {"name":"result","type":"number","expr":{"pipe":{
        \\    "params":[{"paramName":"x","sourceIdent":"input"}],
        \\    "steps":[
        \\      {"fn":"add","args":[{"ref":"x"},{"lit":1}]},
        \\      {"fn":"mul","args":[{"stepRef":0},{"lit":10}]}
        \\    ]
        \\  }}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    var result = try loaded.execute(std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 30), result.value.number);
}

test "compute pipes reject empty and forward step references" {
    var empty = try LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"result\",\"prog\":{\"bindings\":[{\"name\":\"result\",\"type\":\"number\",\"expr\":{\"pipe\":{\"params\":[],\"steps\":[]}}}]}}",
    );
    defer empty.deinit();
    try std.testing.expectError(error.EmptyPipe, empty.execute(std.testing.allocator));

    var forward = try LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"result\",\"prog\":{\"bindings\":[{\"name\":\"result\",\"type\":\"number\",\"expr\":{\"pipe\":{\"params\":[],\"steps\":[{\"fn\":\"add\",\"args\":[{\"stepRef\":0},{\"lit\":1}]}]}}}]}}",
    );
    defer forward.deinit();
    try std.testing.expectError(error.InvalidStepReference, forward.execute(std.testing.allocator));
}

test "prepared inputs override value bindings and preserve tags" {
    const fixture =
        \\{"root":"result","prog":{"bindings":[
        \\  {"name":"input","type":"number"},
        \\  {"name":"result","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"input"},{"lit":1}]}}}
        \\]}}
    ;
    var loaded = try LoadedCompute.init(std.testing.allocator, fixture);
    defer loaded.deinit();
    var inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer inputs.deinit(std.testing.allocator);
    try inputs.put(std.testing.allocator, "input", .{ .value = .{ .number = 9 }, .tags = &.{"state"} });
    var result = try loaded.executeWithInputs(&inputs, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(f64, 10), result.value.number);
    try std.testing.expectEqualSlices([]const u8, &.{"state"}, result.tags);
}

test "uninjected bindings without defaults fail during execution" {
    var loaded = try LoadedCompute.init(
        std.testing.allocator,
        "{\"root\":\"input\",\"prog\":{\"bindings\":[{\"name\":\"input\",\"type\":\"number\"}]}}",
    );
    defer loaded.deinit();
    try std.testing.expectError(error.MissingBindingValue, loaded.execute(std.testing.allocator));
}

test "compute without a root returns missing null" {
    var loaded = try LoadedCompute.init(
        std.testing.allocator,
        "{\"prog\":{\"bindings\":[{\"name\":\"value\",\"type\":\"number\",\"value\":1}]}}",
    );
    defer loaded.deinit();
    var result = try loaded.execute(std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(value.NullReason.missing, result.value.null_value);
    try std.testing.expectEqual(@as(usize, 0), result.tags.len);
}
