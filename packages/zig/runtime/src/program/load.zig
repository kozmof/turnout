//! JSON to `Program`.
//!
//! This is the only place in the execution path that touches `std.json`. It
//! walks the tree once, resolves every name to an index and every function to an
//! enum, and converts literals to values.
//!
//! What it cannot resolve it records as an `invalid` node carrying the error to
//! raise, rather than failing the load. That is deliberate: an unresolvable
//! reference in a conditional branch that is never taken has always been legal,
//! and deferring the error keeps it legal without keeping the name around.
//!
//! Strings in the result borrow from `prog`, which must outlive the program.

const std = @import("std");
const fn_aliases = @import("../generated/fn_aliases.zig");
const ir = @import("ir.zig");
const preset = @import("../preset.zig");
const value = @import("../value.zig");

/// Loading fails only on allocation or on a literal JSON cannot represent as a
/// value. Every other problem becomes a deferred `invalid` node.
pub const Error = error{ OutOfMemory, InvalidNumber, NonFiniteNumber };

const Scope = std.StringHashMapUnmanaged(u32);

/// Lowers a `prog` object. Structural diagnosis belongs to
/// `compute.validateProgram`; anything still malformed here becomes a deferred
/// error rather than a load failure.
pub fn program(
    prog: std.json.Value,
    root_name: []const u8,
    parent: std.mem.Allocator,
) Error!ir.OwnedProgram {
    var arena: std.heap.ArenaAllocator = .init(parent);
    errdefer arena.deinit();
    const lowered = try into(prog, root_name, arena.allocator());
    return .{ .arena = arena, .program = lowered };
}

/// Lowers into a caller-owned allocator. Intended for an arena that outlives the
/// program, so that many programs share one.
pub fn into(
    prog: std.json.Value,
    root_name: []const u8,
    allocator: std.mem.Allocator,
) Error!ir.Program {
    const raw_bindings = bindingsOf(prog);
    const bindings = try allocator.alloc(ir.Binding, raw_bindings.len);

    // Names resolve against bindings declared *earlier*. That is what makes a
    // forward reference a `MissingReference`, exactly as ordered execution did.
    var scope: Scope = .empty;
    defer scope.deinit(allocator);

    var root: ir.Root = if (root_name.len == 0) .none else .unresolved;
    for (raw_bindings, 0..) |raw, index| {
        const name = stringField(raw, "name") orelse "";
        bindings[index] = .{ .name = name, .body = try body(raw, &scope, allocator) };
        if (root == .unresolved and std.mem.eql(u8, name, root_name))
            root = .{ .binding = @intCast(index) };
        // Recorded after lowering, so a binding cannot reference itself.
        if (name.len > 0 and !scope.contains(name))
            try scope.put(allocator, name, @intCast(index));
    }

    return .{ .bindings = bindings, .root = root };
}

fn bindingsOf(prog: std.json.Value) []const std.json.Value {
    if (prog != .object) return &.{};
    const bindings = prog.object.get("bindings") orelse return &.{};
    if (bindings != .array) return &.{};
    return bindings.array.items;
}

fn body(raw: std.json.Value, scope: *const Scope, allocator: std.mem.Allocator) Error!ir.Body {
    if (raw != .object) return .{ .invalid = error.InvalidExpression };
    if (raw.object.get("expr")) |expression| return expr(expression, scope, allocator);
    // No expression: a prepared input wins, and this literal is the fallback.
    if (raw.object.get("value")) |literal|
        return .{ .supplied = try value.fromJson(allocator, literal) };
    return .{ .supplied = null };
}

fn expr(expression: std.json.Value, scope: *const Scope, allocator: std.mem.Allocator) Error!ir.Body {
    const invalid: ir.Body = .{ .invalid = error.InvalidExpression };
    if (expression != .object) return invalid;
    if (expression.object.get("combine")) |combine| {
        const loaded = try loadCall(combine, scope, null, allocator) orelse return invalid;
        return .{ .combine = loaded };
    }
    if (expression.object.get("pipe")) |pipe| {
        const loaded = try loadPipe(pipe, scope, allocator) orelse return invalid;
        return .{ .pipe = loaded };
    }
    if (expression.object.get("cond")) |cond| {
        const loaded = try loadCond(cond, scope, allocator) orelse return invalid;
        return .{ .cond = loaded };
    }
    return invalid;
}

/// Null means the shape is wrong and the caller should raise
/// `InvalidExpression`, which is where that error surfaced before.
fn loadCall(
    call: std.json.Value,
    scope: *const Scope,
    params: ?*const Scope,
    allocator: std.mem.Allocator,
) Error!?ir.Call {
    if (call != .object) return null;
    const name = stringField(call, "fn") orelse return null;
    const args = call.object.get("args") orelse return null;
    if (args != .array) return null;
    return .{
        .function = aliased(name),
        .args = try loadArgs(args.array.items, scope, params, true, allocator),
    };
}

fn loadPipe(pipe: std.json.Value, scope: *const Scope, allocator: std.mem.Allocator) Error!?ir.Pipe {
    if (pipe != .object) return null;
    const raw_params = pipe.object.get("params") orelse return null;
    const raw_steps = pipe.object.get("steps") orelse return null;
    if (raw_params != .array or raw_steps != .array) return null;

    // Parameter order is index order; a step names a parameter by that index.
    var by_name: Scope = .empty;
    defer by_name.deinit(allocator);
    const params = try allocator.alloc(ir.Arg, raw_params.array.items.len);
    for (raw_params.array.items, 0..) |raw, index| {
        params[index] = param: {
            if (raw != .object) break :param .{ .invalid = error.InvalidArgument };
            const name = stringField(raw, "paramName") orelse
                break :param .{ .invalid = error.InvalidArgument };
            const source = stringField(raw, "sourceIdent") orelse
                break :param .{ .invalid = error.InvalidArgument };
            if (name.len == 0) break :param .{ .invalid = error.InvalidArgument };
            if (by_name.contains(name)) break :param .{ .invalid = error.DuplicateParameter };
            try by_name.put(allocator, name, @intCast(index));
            break :param reference(source, scope, null);
        };
    }

    const steps = try allocator.alloc(ir.PipeStep, raw_steps.array.items.len);
    for (raw_steps.array.items, 0..) |raw, index| {
        steps[index] = if (try loadCall(raw, scope, &by_name, allocator)) |call|
            .{ .call = call }
        else
            .{ .invalid = error.InvalidExpression };
    }

    return .{ .params = params, .steps = steps };
}

fn loadCond(cond: std.json.Value, scope: *const Scope, allocator: std.mem.Allocator) Error!?ir.Cond {
    if (cond != .object) return null;
    const condition = cond.object.get("condition") orelse return null;
    const then_branch = cond.object.get("then") orelse return null;
    const else_branch = cond.object.get("elseBranch") orelse return null;
    // Conditional arguments take no transform.
    return .{
        .condition = try arg(condition, scope, null, false, allocator),
        .then_branch = try arg(then_branch, scope, null, false, allocator),
        .else_branch = try arg(else_branch, scope, null, false, allocator),
    };
}

fn loadArgs(
    raw: []const std.json.Value,
    scope: *const Scope,
    params: ?*const Scope,
    allow_transform: bool,
    allocator: std.mem.Allocator,
) Error![]const ir.Arg {
    const args = try allocator.alloc(ir.Arg, raw.len);
    for (raw, 0..) |item, index|
        args[index] = try arg(item, scope, params, allow_transform, allocator);
    return args;
}

fn arg(
    raw: std.json.Value,
    scope: *const Scope,
    params: ?*const Scope,
    allow_transform: bool,
    allocator: std.mem.Allocator,
) Error!ir.Arg {
    if (raw != .object) return .{ .invalid = error.InvalidArgument };
    // Exactly one variant key may be present.
    var variants: usize = 0;
    inline for (.{ "ref", "funcRef", "lit", "stepRef", "transform" }) |name| {
        if (raw.object.contains(name)) variants += 1;
    }
    if (variants != 1) return .{ .invalid = error.InvalidArgument };

    if (raw.object.get("stepRef")) |step| {
        if (step != .integer or step.integer < 0) return .{ .invalid = error.InvalidStepReference };
        return .{ .step = @intCast(step.integer) };
    }
    if (raw.object.get("ref") orelse raw.object.get("funcRef")) |name| {
        if (name != .string) return .{ .invalid = error.InvalidArgument };
        return reference(name.string, scope, params);
    }
    if (raw.object.get("lit")) |literal|
        return .{ .literal = try value.fromJson(allocator, literal) };
    if (raw.object.get("transform")) |transform| {
        if (!allow_transform) return .{ .invalid = error.UnsupportedArgument };
        return loadTransform(transform, scope, params, allocator);
    }
    return .{ .invalid = error.UnsupportedArgument };
}

fn loadTransform(
    transform: std.json.Value,
    scope: *const Scope,
    params: ?*const Scope,
    allocator: std.mem.Allocator,
) Error!ir.Arg {
    if (transform != .object) return .{ .invalid = error.InvalidArgument };
    const name = stringField(transform, "ref") orelse return .{ .invalid = error.InvalidArgument };
    const raw_functions = transform.object.get("fn") orelse return .{ .invalid = error.InvalidArgument };
    if (raw_functions != .array) return .{ .invalid = error.InvalidArgument };

    const source = try allocator.create(ir.Arg);
    source.* = reference(name, scope, params);
    const functions = try allocator.alloc(ir.Function, raw_functions.array.items.len);
    for (raw_functions.array.items, 0..) |raw, index| {
        // Transform names are already runtime names; they are never aliased.
        functions[index] = if (raw == .string) direct(raw.string) else .unknown;
    }
    return .{ .transform = .{ .source = source, .functions = functions } };
}

/// Parameters shadow bindings, matching the lookup order pipe execution used.
fn reference(name: []const u8, scope: *const Scope, params: ?*const Scope) ir.Arg {
    if (params) |table| if (table.get(name)) |index| return .{ .param = index };
    if (scope.get(name)) |index| return .{ .binding = index };
    return .{ .invalid = error.MissingReference };
}

fn aliased(name: []const u8) ir.Function {
    return direct(fn_aliases.resolve(name) orelse name);
}

fn direct(name: []const u8) ir.Function {
    return if (preset.lookup(name)) |found| .{ .resolved = found } else .unknown;
}

fn stringField(object: std.json.Value, key: []const u8) ?[]const u8 {
    if (object != .object) return null;
    const field = object.object.get(key) orelse return null;
    return if (field == .string) field.string else null;
}

// ── tests ───────────────────────────────────────────────────────────────────

const testing = std.testing;

/// Parses `source` and lowers its `prog`, so a test can inspect the IR without
/// running it. The caller owns both; the parsed JSON must outlive the program.
fn lower(source: []const u8, root_name: []const u8) !struct {
    parsed: std.json.Parsed(std.json.Value),
    program: ir.OwnedProgram,

    fn deinit(self: *@This()) void {
        self.program.deinit();
        self.parsed.deinit();
    }
} {
    const parsed = try std.json.parseFromSlice(std.json.Value, testing.allocator, source, .{});
    errdefer parsed.deinit();
    const prog = parsed.value.object.get("prog").?;
    return .{
        .parsed = parsed,
        .program = try program(prog, root_name, testing.allocator),
    };
}

test "references lower to indices and functions to enum values" {
    var lowered = try lower(
        \\{"prog":{"bindings":[
        \\  {"name":"left","type":"number","value":2},
        \\  {"name":"total","type":"number","expr":{"combine":{"fn":"add","args":[{"ref":"left"},{"lit":5}]}}}
        \\]}}
    , "total");
    defer lowered.deinit();

    try testing.expectEqual(@as(usize, 2), lowered.program.program.bindings.len);
    try testing.expectEqual(@as(u32, 1), lowered.program.program.root.binding);

    const combine = lowered.program.program.bindings[1].body.combine;
    try testing.expectEqualStrings("combineFnNumber::add", @tagName(combine.function.resolved));
    // The reference became an index into the bindings, not a name to hash.
    try testing.expectEqual(@as(u32, 0), combine.args[0].binding);
    try testing.expectEqual(@as(f64, 5), combine.args[1].literal.number);
}

test "an unresolvable reference becomes a deferred error rather than a load failure" {
    // `later` is declared after the binding that uses it, and `absent` never.
    // Both must load: the second one sits in a branch that may never run.
    var lowered = try lower(
        \\{"prog":{"bindings":[
        \\  {"name":"early","type":"number","expr":{"cond":{"condition":{"ref":"absent"},"then":{"ref":"later"},"elseBranch":{"lit":0}}}},
        \\  {"name":"later","type":"number","value":2}
        \\]}}
    , "");
    defer lowered.deinit();

    const cond = lowered.program.program.bindings[0].body.cond;
    try testing.expectEqual(error.MissingReference, cond.condition.invalid);
    try testing.expectEqual(error.MissingReference, cond.then_branch.invalid);
    try testing.expectEqual(ir.Root.none, lowered.program.program.root);
}

test "pipe parameters shadow bindings and steps reference them by index" {
    var lowered = try lower(
        \\{"prog":{"bindings":[
        \\  {"name":"seed","type":"number","value":3},
        \\  {"name":"out","type":"number","expr":{"pipe":{
        \\    "params":[{"paramName":"seed","sourceIdent":"seed"}],
        \\    "steps":[{"fn":"add","args":[{"ref":"seed"},{"lit":1}]}]}}}
        \\]}}
    , "out");
    defer lowered.deinit();

    const pipe = lowered.program.program.bindings[1].body.pipe;
    try testing.expectEqual(@as(u32, 0), pipe.params[0].binding);
    // "seed" names both a binding and a parameter; the parameter wins.
    try testing.expectEqual(@as(u32, 0), pipe.steps[0].call.args[0].param);
}

test "a duplicate parameter defers rather than failing the load" {
    var lowered = try lower(
        \\{"prog":{"bindings":[
        \\  {"name":"seed","type":"number","value":3},
        \\  {"name":"out","type":"number","expr":{"pipe":{
        \\    "params":[{"paramName":"p","sourceIdent":"seed"},{"paramName":"p","sourceIdent":"seed"}],
        \\    "steps":[{"fn":"add","args":[{"ref":"p"},{"lit":1}]}]}}}
        \\]}}
    , "out");
    defer lowered.deinit();
    try testing.expectEqual(error.DuplicateParameter, lowered.program.program.bindings[1].body.pipe.params[1].invalid);
}

test "an unknown function name lowers to unknown, not to a load failure" {
    var lowered = try lower(
        \\{"prog":{"bindings":[
        \\  {"name":"out","type":"number","expr":{"combine":{"fn":"no_such_fn","args":[{"lit":1},{"lit":2}]}}}
        \\]}}
    , "out");
    defer lowered.deinit();
    try testing.expectEqual(ir.Function.unknown, lowered.program.program.bindings[0].body.combine.function);
}

test "a binding with neither expression nor value awaits a prepared input" {
    var lowered = try lower(
        \\{"prog":{"bindings":[{"name":"from_state","type":"number"}]}}
    , "");
    defer lowered.deinit();
    try testing.expect(lowered.program.program.bindings[0].body.supplied == null);
}
