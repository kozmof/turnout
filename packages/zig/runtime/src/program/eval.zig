//! Evaluates a lowered `Program`.
//!
//! Nothing here touches JSON, resolves a name, or looks anything up by string.
//! An argument is a tag plus an index; a function is an integer. The only
//! remaining string work is matching prepared inputs to binding names, which
//! happens once per binding rather than once per reference.
//!
//! Reference arguments are passed to presets as borrowed views. Only values that
//! must outlive the call — a binding's own result, a transform chain, a pipe
//! step — are allocated.

const std = @import("std");
const ir = @import("ir.zig");
const preset = @import("../preset.zig");
const value = @import("../value.zig");

pub const Error = ir.EvalError || preset.CallError;

pub const Result = struct {
    bindings: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    root: value.OwnedTaggedValue,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        for (self.bindings.values()) |*item| item.deinit(allocator);
        self.bindings.deinit(allocator);
        self.root.deinit(allocator);
        self.* = undefined;
    }
};

/// Runs every binding in declaration order, then resolves the root.
pub fn run(
    program: *const ir.Program,
    inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    allocator: std.mem.Allocator,
) Error!Result {
    const computed = try allocator.alloc(value.OwnedTaggedValue, program.bindings.len);
    var done: usize = 0;
    defer allocator.free(computed);
    errdefer for (computed[0..done]) |*item| item.deinit(allocator);

    for (program.bindings) |binding| {
        computed[done] = try evalBinding(binding, computed[0..done], inputs, allocator);
        done += 1;
    }

    var root = try rootValue(program, computed[0..done], allocator);
    errdefer root.deinit(allocator);

    // Ownership moves into the map; the failure path above no longer applies.
    var bindings: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue) = .empty;
    errdefer {
        for (bindings.values()) |*item| item.deinit(allocator);
        bindings.deinit(allocator);
    }
    try bindings.ensureTotalCapacity(allocator, @intCast(program.bindings.len));
    for (program.bindings, computed[0..done]) |binding, item| {
        if (bindings.getPtr(binding.name)) |existing| {
            existing.deinit(allocator);
            existing.* = item;
        } else {
            bindings.putAssumeCapacity(binding.name, item);
        }
    }
    done = 0;

    return .{ .bindings = bindings, .root = root };
}

fn rootValue(
    program: *const ir.Program,
    computed: []const value.OwnedTaggedValue,
    allocator: std.mem.Allocator,
) Error!value.OwnedTaggedValue {
    return switch (program.root) {
        .none => value.buildNull(.missing, &.{}, allocator),
        .unresolved => error.MissingRootBinding,
        .binding => |index| blk: {
            if (index >= computed.len) break :blk error.MissingRootBinding;
            const found = computed[index];
            break :blk value.build(found.value, found.tags, allocator);
        },
    };
}

fn evalBinding(
    binding: ir.Binding,
    computed: []const value.OwnedTaggedValue,
    inputs: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    allocator: std.mem.Allocator,
) Error!value.OwnedTaggedValue {
    return switch (binding.body) {
        .invalid => |err| err,
        .supplied => |literal| {
            // A prepared input overrides the declared literal.
            if (inputs.get(binding.name)) |input|
                return value.build(input.value, input.tags, allocator);
            if (literal) |declared| return value.build(declared, &.{}, allocator);
            return error.MissingBindingValue;
        },
        .combine => |combine| evalCall(combine, .{ .values = computed }, allocator),
        .pipe => |pipe| evalPipe(pipe, computed, allocator),
        .cond => |cond| evalCond(cond, computed, allocator),
    };
}

/// What an argument index can point at. `params` and `steps` are empty outside a
/// pipe, which is why a `param` or `step` argument cannot appear there.
const Env = struct {
    values: []const value.OwnedTaggedValue,
    params: []const value.TaggedValue = &.{},
    steps: []const value.OwnedTaggedValue = &.{},
};

/// A resolved argument. `owned` is set only when the argument had to allocate;
/// a plain reference or literal is borrowed straight from where it already
/// lives.
const Slot = struct {
    view: value.TaggedValue,
    owned: ?value.OwnedTaggedValue = null,

    fn deinit(self: *Slot, allocator: std.mem.Allocator) void {
        if (self.owned) |*item| item.deinit(allocator);
        self.* = undefined;
    }
};

fn evalCall(call: ir.Call, env: Env, allocator: std.mem.Allocator) Error!value.OwnedTaggedValue {
    const function = switch (call.function) {
        .resolved => |found| found,
        .unknown => return error.UnknownFunction,
    };

    var slots = try allocator.alloc(Slot, call.args.len);
    var filled: usize = 0;
    defer {
        for (slots[0..filled]) |*slot| slot.deinit(allocator);
        allocator.free(slots);
    }
    var views = try allocator.alloc(value.TaggedValue, call.args.len);
    defer allocator.free(views);

    for (call.args) |argument| {
        slots[filled] = try resolve(argument, env, allocator);
        views[filled] = slots[filled].view;
        filled += 1;
    }
    return preset.callFn(function, views, allocator);
}

fn evalPipe(
    pipe: ir.Pipe,
    computed: []const value.OwnedTaggedValue,
    allocator: std.mem.Allocator,
) Error!value.OwnedTaggedValue {
    // Checked before the parameters, which is the order the previous executor
    // used and which some fixtures depend on.
    if (pipe.steps.len == 0) return error.EmptyPipe;

    // A parameter is an alias for a binding already computed, so it borrows.
    const params = try allocator.alloc(value.TaggedValue, pipe.params.len);
    defer allocator.free(params);
    for (pipe.params, 0..) |source, index| {
        params[index] = switch (source) {
            .binding => |binding| computed[binding].borrowed(),
            .invalid => |err| return err,
            else => return error.InvalidArgument,
        };
    }

    var results = try allocator.alloc(value.OwnedTaggedValue, pipe.steps.len);
    var done: usize = 0;
    defer {
        for (results[0..done]) |*item| item.deinit(allocator);
        allocator.free(results);
    }
    for (pipe.steps) |step| {
        const env: Env = .{ .values = computed, .params = params, .steps = results[0..done] };
        results[done] = switch (step) {
            .call => |call| try evalCall(call, env, allocator),
            .invalid => |err| return err,
        };
        done += 1;
    }

    const final = results[done - 1];
    return value.build(final.value, final.tags, allocator);
}

fn evalCond(
    cond: ir.Cond,
    computed: []const value.OwnedTaggedValue,
    allocator: std.mem.Allocator,
) Error!value.OwnedTaggedValue {
    const env: Env = .{ .values = computed };
    var condition = try resolve(cond.condition, env, allocator);
    defer condition.deinit(allocator);
    if (condition.view.value != .boolean) return error.ConditionTypeMismatch;

    // Only the selected branch is resolved, so an unresolvable reference in the
    // other one never raises.
    const branch = if (condition.view.value.boolean) cond.then_branch else cond.else_branch;
    var selected = try resolve(branch, env, allocator);
    defer selected.deinit(allocator);
    return value.build(selected.view.value, selected.view.tags, allocator);
}

fn resolve(argument: ir.Arg, env: Env, allocator: std.mem.Allocator) Error!Slot {
    return switch (argument) {
        .binding => |index| .{ .view = env.values[index].borrowed() },
        .param => |index| if (index < env.params.len)
            .{ .view = env.params[index] }
        else
            error.MissingReference,
        .step => |index| if (index < env.steps.len)
            .{ .view = env.steps[index].borrowed() }
        else
            error.InvalidStepReference,
        .literal => |literal| .{ .view = .{ .value = literal } },
        .transform => |transform| blk: {
            const owned = try applyTransforms(transform, env, allocator);
            break :blk .{ .view = owned.borrowed(), .owned = owned };
        },
        .invalid => |err| err,
    };
}

fn applyTransforms(
    transform: ir.Transform,
    env: Env,
    allocator: std.mem.Allocator,
) Error!value.OwnedTaggedValue {
    var source = try resolve(transform.source.*, env, allocator);
    defer source.deinit(allocator);

    var current = try value.build(source.view.value, source.view.tags, allocator);
    errdefer current.deinit(allocator);
    for (transform.functions) |function| {
        const resolved = switch (function) {
            .resolved => |found| found,
            .unknown => return error.UnknownFunction,
        };
        const next = try preset.callFn(resolved, &.{current.borrowed()}, allocator);
        current.deinit(allocator);
        current = next;
    }
    return current;
}

// ── tests ───────────────────────────────────────────────────────────────────

const compute = @import("../compute.zig");
const testing = std.testing;

fn runSource(source: []const u8) !value.OwnedTaggedValue {
    const parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, source, .{});
    defer parsed.deinit();
    const inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    return compute.executeJson(parsed.value, &inputs, testing.allocator);
}

test "an empty pipe is rejected before its parameters are bound" {
    // Both faults are present. `EmptyPipe` wins, which is the order the JSON
    // executor used and which the shared error vectors encode.
    try testing.expectError(error.EmptyPipe, runSource(
        \\{"root":"out","prog":{"bindings":[{"name":"out","type":"number","expr":{"pipe":{
        \\  "params":[{"paramName":"p","sourceIdent":"nowhere"}],"steps":[]}}}]}}
    ));
}

test "a deferred error raises only when its node is reached" {
    // The else branch names a binding that does not exist. Taking the then
    // branch must not raise.
    var taken = try runSource(
        \\{"root":"out","prog":{"bindings":[
        \\  {"name":"flag","type":"bool","value":true},
        \\  {"name":"out","type":"number","expr":{"cond":{"condition":{"ref":"flag"},"then":{"lit":1},"elseBranch":{"ref":"absent"}}}}
        \\]}}
    );
    defer taken.deinit(testing.allocator);
    try testing.expectEqual(@as(f64, 1), taken.value.number);

    // Flip the condition and the same program raises.
    try testing.expectError(error.MissingReference, runSource(
        \\{"root":"out","prog":{"bindings":[
        \\  {"name":"flag","type":"bool","value":false},
        \\  {"name":"out","type":"number","expr":{"cond":{"condition":{"ref":"flag"},"then":{"lit":1},"elseBranch":{"ref":"absent"}}}}
        \\]}}
    ));
}

test "tags propagate through borrowed reference arguments" {
    // Reference arguments are passed to presets as views rather than clones.
    // Their tags must still reach the result.
    const parsed = try std.json.parseFromSlice(
        std.json.Value,
        testing.allocator,
        \\{"root":"out","prog":{"bindings":[
        \\  {"name":"a","type":"number"},
        \\  {"name":"b","type":"number"},
        \\  {"name":"out","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"a"},{"ref":"b"}]}}}
        \\]}}
    ,
        .{},
    );
    defer parsed.deinit();

    var inputs: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer inputs.deinit(testing.allocator);
    try inputs.put(testing.allocator, "a", .{ .value = .{ .number = 1 }, .tags = &.{"state"} });
    try inputs.put(testing.allocator, "b", .{ .value = .{ .number = 2 }, .tags = &.{"hook"} });

    var result = try compute.executeJson(parsed.value, &inputs, testing.allocator);
    defer result.deinit(testing.allocator);
    try testing.expectEqual(@as(f64, 3), result.value.number);
    try testing.expectEqualSlices([]const u8, &.{ "state", "hook" }, result.tags);
}
