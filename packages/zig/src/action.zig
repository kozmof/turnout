const std = @import("std");
const compute = @import("compute.zig");
const state_runtime = @import("state.zig");
const value = @import("value.zig");

pub const MergeWarning = struct {
    binding: []const u8,
    to_state: []const u8,
};

pub const Result = struct {
    compute_root: value.OwnedTaggedValue,
    binding_values: std.StringArrayHashMapUnmanaged(value.OwnedTaggedValue),
    state_after_merge: state_runtime.State,
    merge_warnings: []MergeWarning,
    unchecked_write_paths: []const []const u8,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        self.compute_root.deinit(allocator);
        var iterator = self.binding_values.iterator();
        while (iterator.next()) |entry| entry.value_ptr.deinit(allocator);
        self.binding_values.deinit(allocator);
        self.state_after_merge.deinit(allocator);
        allocator.free(self.merge_warnings);
        allocator.free(self.unchecked_write_paths);
        self.* = undefined;
    }

    pub fn takeState(self: *Result) state_runtime.State {
        const state = self.state_after_merge;
        self.state_after_merge = .{};
        return state;
    }
};

pub fn execute(
    action: std.json.Value,
    state: *const state_runtime.State,
    allocator: std.mem.Allocator,
) !Result {
    const prepared_hooks: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    return executeWithPrepared(action, state, &prepared_hooks, allocator);
}

pub fn executeWithPrepared(
    action: std.json.Value,
    state: *const state_runtime.State,
    prepared_hooks: *const std.StringArrayHashMapUnmanaged(value.TaggedValue),
    allocator: std.mem.Allocator,
) !Result {
    if (action != .object) return error.InvalidAction;
    const compute_model = action.object.get("compute") orelse return noOp(state, allocator);
    if (compute_model != .object) return noOp(state, allocator);
    const prog = compute_model.object.get("prog") orelse return noOp(state, allocator);
    const root_value = compute_model.object.get("root") orelse std.json.Value{ .string = "" };
    if (root_value != .string) return error.InvalidAction;

    var prepared: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer {
        for (prepared.values()) |*item| value.deinitTaggedValue(item, allocator);
        prepared.deinit(allocator);
    }
    if (action.object.get("prepare")) |prepare| {
        if (prepare != .array) return error.InvalidAction;
        for (prepare.array.items) |entry| {
            if (entry != .object) return error.InvalidPrepare;
            const binding = entry.object.get("binding") orelse return error.InvalidPrepare;
            if (binding != .string or binding.string.len == 0) return error.InvalidPrepare;
            var prepared_value = if (entry.object.get("fromHook")) |from_hook| blk: {
                if (from_hook != .string or from_hook.string.len == 0) return error.InvalidPrepare;
                const supplied = prepared_hooks.get(binding.string) orelse return error.HookRequired;
                break :blk try value.build(supplied.value, supplied.tags, allocator);
            } else blk: {
                const from_state = entry.object.get("fromState") orelse continue;
                if (from_state != .string) return error.InvalidPrepare;
                break :blk try state.read(from_state.string, allocator);
            };
            const tagged = prepared_value.borrowed();
            if (prepared.getPtr(binding.string)) |previous| {
                value.deinitTaggedValue(previous, allocator);
                previous.* = tagged;
                continue;
            }
            prepared.put(allocator, binding.string, tagged) catch |err| {
                prepared_value.deinit(allocator);
                return err;
            };
        }
    }

    var computed = try compute.executeProgramWithBindings(prog, root_value.string, &prepared, allocator);
    errdefer computed.deinit(allocator);
    var warnings = std.ArrayList(MergeWarning).empty;
    errdefer warnings.deinit(allocator);
    var batch: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer batch.deinit(allocator);
    if (action.object.get("merge")) |merge| {
        if (merge != .array) return error.InvalidAction;
        for (merge.array.items) |entry| {
            if (entry != .object) return error.InvalidMerge;
            const binding = entry.object.get("binding") orelse return error.InvalidMerge;
            const to_state = entry.object.get("toState") orelse return error.InvalidMerge;
            if (binding != .string or to_state != .string or to_state.string.len == 0)
                return error.InvalidMerge;
            if (computed.bindings.get(binding.string)) |binding_value| {
                try batch.put(allocator, to_state.string, binding_value.borrowed());
            } else {
                try warnings.append(allocator, .{
                    .binding = binding.string,
                    .to_state = to_state.string,
                });
            }
        }
    }
    var merged = if (batch.count() == 0)
        try state.snapshot(allocator)
    else
        try state.writeBatch(&batch, allocator);
    errdefer merged.deinit(allocator);
    const merge_warnings = try warnings.toOwnedSlice(allocator);
    errdefer allocator.free(merge_warnings);
    const unchecked_write_paths = if (!state.isSchemaManaged() and batch.count() > 0) blk: {
        const paths = try allocator.alloc([]const u8, batch.count());
        for (batch.keys(), 0..) |path, index| paths[index] = path;
        break :blk paths;
    } else try allocator.alloc([]const u8, 0);
    return .{
        .compute_root = computed.root,
        .binding_values = computed.bindings,
        .state_after_merge = merged,
        .merge_warnings = merge_warnings,
        .unchecked_write_paths = unchecked_write_paths,
    };
}

fn noOp(state: *const state_runtime.State, allocator: std.mem.Allocator) !Result {
    var root = try value.buildNull(.missing, &.{}, allocator);
    errdefer root.deinit(allocator);
    var snapshot = try state.snapshot(allocator);
    errdefer snapshot.deinit(allocator);
    const merge_warnings = try allocator.alloc(MergeWarning, 0);
    errdefer allocator.free(merge_warnings);
    return .{
        .compute_root = root,
        .binding_values = .empty,
        .state_after_merge = snapshot,
        .merge_warnings = merge_warnings,
        .unchecked_write_paths = try allocator.alloc([]const u8, 0),
    };
}

test "hook-free action prepares computes and merges" {
    const allocator = std.testing.allocator;
    const source =
        \\{
        \\  "id":"increment",
        \\  "compute":{"root":"result","prog":{"bindings":[
        \\    {"name":"input","type":"number"},
        \\    {"name":"result","type":"number","expr":{
        \\      "combine":{"fn":"add","args":[{"ref":"input"},{"lit":2}]}
        \\    }}
        \\  ]}},
        \\  "prepare":[{"binding":"input","fromState":"counter.value"}],
        \\  "merge":[{"binding":"result","toState":"counter.value"}]
        \\}
    ;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, source, .{});
    defer parsed.deinit();
    var initial: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer initial.deinit(allocator);
    try initial.put(allocator, "counter.value", .{ .value = .{ .number = 3 } });
    var state = try state_runtime.State.initUnchecked(&initial, allocator);
    defer state.deinit(allocator);

    var result = try execute(parsed.value, &state, allocator);
    defer result.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 5), result.compute_root.value.number);
    try std.testing.expectEqual(@as(f64, 5), result.binding_values.get("result").?.value.number);
    try std.testing.expectEqual(@as(usize, 1), result.unchecked_write_paths.len);
    try std.testing.expectEqualStrings("counter.value", result.unchecked_write_paths[0]);
    var merged = try result.state_after_merge.read("counter.value", allocator);
    defer merged.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 5), merged.value.number);
    var original = try state.read("counter.value", allocator);
    defer original.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 3), original.value.number);
}

test "action reports absent merge bindings and rejects hooks" {
    const allocator = std.testing.allocator;
    const warning_source =
        \\{"compute":{"root":"result","prog":{"bindings":[
        \\{"name":"result","type":"number","value":1}
        \\]}},"merge":[{"binding":"ghost","toState":"state.value"}]}
    ;
    const warning_json = try std.json.parseFromSlice(std.json.Value, allocator, warning_source, .{});
    defer warning_json.deinit();
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, allocator);
    defer state.deinit(allocator);
    var result = try execute(warning_json.value, &state, allocator);
    defer result.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 1), result.merge_warnings.len);
    try std.testing.expectEqualStrings("ghost", result.merge_warnings[0].binding);
    try std.testing.expectEqualStrings("state.value", result.merge_warnings[0].to_state);
    try std.testing.expectEqual(@as(usize, 0), result.unchecked_write_paths.len);
    try std.testing.expect(!try result.state_after_merge.exists("state.value"));

    const hook_source =
        \\{"compute":{"prog":{"bindings":[]}},"prepare":[
        \\{"binding":"input","fromHook":"load"}
        \\]}
    ;
    const hook_json = try std.json.parseFromSlice(std.json.Value, allocator, hook_source, .{});
    defer hook_json.deinit();
    try std.testing.expectError(error.HookRequired, execute(hook_json.value, &state, allocator));
}

test "action without compute is a no-op" {
    const allocator = std.testing.allocator;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, "{\"id\":\"noop\"}", .{});
    defer parsed.deinit();
    const empty: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, allocator);
    defer state.deinit(allocator);
    var result = try execute(parsed.value, &state, allocator);
    defer result.deinit(allocator);
    try std.testing.expectEqual(value.NullReason.missing, result.compute_root.value.null_value);
    try std.testing.expectEqual(@as(usize, 0), result.binding_values.count());
}

test "action consumes resumed prepare values by binding" {
    const allocator = std.testing.allocator;
    const source =
        \\{"id":"loaded","compute":{"root":"result","prog":{"bindings":[
        \\{"name":"input","type":"number"},
        \\{"name":"result","type":"number","expr":{
        \\"combine":{"fn":"add","args":[{"ref":"input"},{"lit":2}]}
        \\}}
        \\]}},"prepare":[{"binding":"input","fromHook":"load"}]}
    ;
    const parsed = try std.json.parseFromSlice(std.json.Value, allocator, source, .{});
    defer parsed.deinit();
    const empty_state: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty_state, allocator);
    defer state.deinit(allocator);
    var prepared: std.StringArrayHashMapUnmanaged(value.TaggedValue) = .empty;
    defer prepared.deinit(allocator);
    try prepared.put(allocator, "input", .{ .value = .{ .number = 5 }, .tags = &.{"host"} });

    var result = try executeWithPrepared(parsed.value, &state, &prepared, allocator);
    defer result.deinit(allocator);
    try std.testing.expectEqual(@as(f64, 7), result.compute_root.value.number);
    try std.testing.expect(value.hasTag(result.binding_values.getPtr("input").?.borrowed(), "host"));
}
