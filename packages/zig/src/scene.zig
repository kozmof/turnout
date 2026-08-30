const std = @import("std");
const action_runtime = @import("action.zig");
const model_runtime = @import("model.zig");
const runtime_error = @import("runtime_error.zig");
const state_runtime = @import("state.zig");
const turnout_value = @import("value.zig");

pub const default_max_steps: usize = 10_000;

pub const DuplicateEnqueueWarning = struct {
    action_id: []const u8,
    from_action_id: []const u8,
    first_enqueued_by: ?[]const u8,
};

pub const LogKind = enum { action_start, warning, action_complete };
pub const LogWarningKind = enum {
    merge_warning,
    unchecked_state_write,
    invalid_next_condition,
    missing_next_compute_program,
    duplicate_enqueue,
};
pub const LogEvent = struct {
    kind: LogKind,
    scene_id: []const u8,
    action_id: []const u8,
    step_index: ?usize = null,
    warning_kind: ?LogWarningKind = null,
};

pub const ActionTrace = struct {
    action_id: []const u8,
    next_action_id: ?[]const u8,
    compute_root: turnout_value.OwnedTaggedValue,
    merge_warnings: []action_runtime.MergeWarning,
    unchecked_write_paths: []const []const u8,
    next_warnings: []model_runtime.NextRuleWarning,

    pub fn deinit(self: *ActionTrace, allocator: std.mem.Allocator) void {
        self.compute_root.deinit(allocator);
        allocator.free(self.merge_warnings);
        allocator.free(self.unchecked_write_paths);
        allocator.free(self.next_warnings);
        self.* = undefined;
    }

    pub fn clone(self: *const ActionTrace, allocator: std.mem.Allocator) !ActionTrace {
        var compute_root = try turnout_value.build(
            self.compute_root.value,
            self.compute_root.tags,
            allocator,
        );
        errdefer compute_root.deinit(allocator);
        const merge_warnings = try allocator.dupe(action_runtime.MergeWarning, self.merge_warnings);
        errdefer allocator.free(merge_warnings);
        const unchecked_write_paths = try allocator.dupe([]const u8, self.unchecked_write_paths);
        errdefer allocator.free(unchecked_write_paths);
        return .{
            .action_id = self.action_id,
            .next_action_id = self.next_action_id,
            .compute_root = compute_root,
            .merge_warnings = merge_warnings,
            .unchecked_write_paths = unchecked_write_paths,
            .next_warnings = try allocator.dupe(model_runtime.NextRuleWarning, self.next_warnings),
        };
    }
};

pub const Result = struct {
    state_after_scene: state_runtime.State,
    traces: []ActionTrace,
    terminated_at: []const []const u8,
    duplicate_warnings: []DuplicateEnqueueWarning,
    logs: []LogEvent,

    pub fn deinit(self: *Result, allocator: std.mem.Allocator) void {
        self.state_after_scene.deinit(allocator);
        for (self.traces) |*trace| trace.deinit(allocator);
        allocator.free(self.traces);
        allocator.free(self.terminated_at);
        allocator.free(self.duplicate_warnings);
        allocator.free(self.logs);
        self.* = undefined;
    }

    pub fn takeState(self: *Result) state_runtime.State {
        const state = self.state_after_scene;
        self.state_after_scene = .{};
        return state;
    }
};

pub const Failure = struct {
    err: anyerror,
    code: runtime_error.Code,
    partial_state: state_runtime.State,
    failed_action_id: ?[]const u8,
    logs: []LogEvent,

    pub fn deinit(self: *Failure, allocator: std.mem.Allocator) void {
        self.partial_state.deinit(allocator);
        allocator.free(self.logs);
        self.* = undefined;
    }
};

pub const SafeResult = union(enum) {
    success: Result,
    failure: Failure,

    pub fn deinit(self: *SafeResult, allocator: std.mem.Allocator) void {
        switch (self.*) {
            .success => |*result| result.deinit(allocator),
            .failure => |*failure| failure.deinit(allocator),
        }
        self.* = undefined;
    }
};

pub fn execute(
    model: *const model_runtime.RuntimeModel,
    scene_id: []const u8,
    initial_state: *const state_runtime.State,
    max_steps: usize,
    allocator: std.mem.Allocator,
) !Result {
    var current_state = try initial_state.snapshot(allocator);
    defer current_state.deinit(allocator);
    var failed_action_id: ?[]const u8 = null;
    var logs = std.ArrayList(LogEvent).empty;
    defer logs.deinit(allocator);
    return executeOwned(model, scene_id, &current_state, max_steps, &failed_action_id, &logs, allocator);
}

pub fn executeSafe(
    model: *const model_runtime.RuntimeModel,
    scene_id: []const u8,
    initial_state: *const state_runtime.State,
    max_steps: usize,
    allocator: std.mem.Allocator,
) !SafeResult {
    var current_state = try initial_state.snapshot(allocator);
    errdefer current_state.deinit(allocator);
    var failed_action_id: ?[]const u8 = null;
    var logs = std.ArrayList(LogEvent).empty;
    errdefer logs.deinit(allocator);
    const result = executeOwned(
        model,
        scene_id,
        &current_state,
        max_steps,
        &failed_action_id,
        &logs,
        allocator,
    ) catch |err| {
        const log_slice = try logs.toOwnedSlice(allocator);
        const partial_state = current_state;
        current_state = .{};
        return .{ .failure = .{
            .err = err,
            .code = runtime_error.fromError(err),
            .partial_state = partial_state,
            .failed_action_id = failed_action_id,
            .logs = log_slice,
        } };
    };
    return .{ .success = result };
}

fn executeOwned(
    model: *const model_runtime.RuntimeModel,
    scene_id: []const u8,
    current_state: *state_runtime.State,
    max_steps: usize,
    failed_action_id: *?[]const u8,
    logs: *std.ArrayList(LogEvent),
    allocator: std.mem.Allocator,
) !Result {
    const scene = findScene(model, scene_id) orelse return error.SceneNotFound;
    const entry = try validateScene(scene, allocator);
    var queue = std.ArrayList([]const u8).empty;
    defer queue.deinit(allocator);
    try queue.append(allocator, entry);
    var queue_head: usize = 0;
    var visited: std.StringHashMapUnmanaged(void) = .empty;
    defer visited.deinit(allocator);
    var enqueue_sources: std.StringHashMapUnmanaged([]const u8) = .empty;
    defer enqueue_sources.deinit(allocator);
    var traces = std.ArrayList(ActionTrace).empty;
    errdefer {
        for (traces.items) |*trace| trace.deinit(allocator);
        traces.deinit(allocator);
    }
    var terminated = std.ArrayList([]const u8).empty;
    errdefer terminated.deinit(allocator);
    var duplicates = std.ArrayList(DuplicateEnqueueWarning).empty;
    errdefer duplicates.deinit(allocator);

    var step_count: usize = 0;
    while (queue_head < queue.items.len) {
        const action_id = queue.items[queue_head];
        queue_head += 1;
        failed_action_id.* = action_id;
        step_count += 1;
        if (step_count > max_steps) return error.MaxStepsExceeded;
        try visited.put(allocator, action_id, {});
        try logs.append(allocator, .{
            .kind = .action_start,
            .scene_id = scene_id,
            .action_id = action_id,
            .step_index = step_count,
        });

        var action_result = try model.executeAction(scene_id, action_id, current_state, allocator);
        defer action_result.deinit(allocator);
        var selection = model.selectNextAfterAction(scene_id, action_id, &action_result, allocator) catch |err| {
            current_state.deinit(allocator);
            current_state.* = action_result.takeState();
            return err;
        };
        defer selection.deinit(allocator);

        current_state.deinit(allocator);
        current_state.* = action_result.takeState();
        const next_action = selection.target;
        if (next_action == null) try terminated.append(allocator, action_id);
        var trace = try makeTrace(action_id, next_action, &action_result, &selection, allocator);
        traces.append(allocator, trace) catch |err| {
            trace.deinit(allocator);
            return err;
        };
        for (action_result.merge_warnings) |_|
            try logs.append(allocator, .{
                .kind = .warning,
                .scene_id = scene_id,
                .action_id = action_id,
                .warning_kind = .merge_warning,
            });
        if (action_result.unchecked_write_paths.len > 0)
            try logs.append(allocator, .{
                .kind = .warning,
                .scene_id = scene_id,
                .action_id = action_id,
                .warning_kind = .unchecked_state_write,
            });
        for (selection.warnings) |warning|
            try logs.append(allocator, .{
                .kind = .warning,
                .scene_id = scene_id,
                .action_id = action_id,
                .warning_kind = switch (warning.kind) {
                    .invalid_condition => .invalid_next_condition,
                    .missing_program => .missing_next_compute_program,
                },
            });

        if (next_action) |target| {
            const previous_source = enqueue_sources.get(target);
            if (previous_source != null or visited.contains(target)) {
                try duplicates.append(allocator, .{
                    .action_id = target,
                    .from_action_id = action_id,
                    .first_enqueued_by = previous_source,
                });
                try logs.append(allocator, .{
                    .kind = .warning,
                    .scene_id = scene_id,
                    .action_id = "",
                    .warning_kind = .duplicate_enqueue,
                });
            } else {
                try enqueue_sources.put(allocator, target, action_id);
                try queue.append(allocator, target);
            }
        }
        try logs.append(allocator, .{
            .kind = .action_complete,
            .scene_id = scene_id,
            .action_id = action_id,
        });
        failed_action_id.* = null;
    }

    const trace_slice = try traces.toOwnedSlice(allocator);
    errdefer {
        for (trace_slice) |*trace| trace.deinit(allocator);
        allocator.free(trace_slice);
    }
    const terminated_slice = try terminated.toOwnedSlice(allocator);
    errdefer allocator.free(terminated_slice);
    const duplicate_slice = try duplicates.toOwnedSlice(allocator);
    errdefer allocator.free(duplicate_slice);
    const log_slice = try logs.toOwnedSlice(allocator);
    const final_state = current_state.*;
    current_state.* = .{};
    return .{
        .state_after_scene = final_state,
        .traces = trace_slice,
        .terminated_at = terminated_slice,
        .duplicate_warnings = duplicate_slice,
        .logs = log_slice,
    };
}

fn makeTrace(
    action_id: []const u8,
    next_action: ?[]const u8,
    action_result: *const action_runtime.Result,
    selection: *const model_runtime.NextRuleSelection,
    allocator: std.mem.Allocator,
) !ActionTrace {
    var compute_root = try turnout_value.build(
        action_result.compute_root.value,
        action_result.compute_root.tags,
        allocator,
    );
    errdefer compute_root.deinit(allocator);
    const merge_warnings = try allocator.dupe(action_runtime.MergeWarning, action_result.merge_warnings);
    errdefer allocator.free(merge_warnings);
    const unchecked_write_paths = try allocator.dupe([]const u8, action_result.unchecked_write_paths);
    errdefer allocator.free(unchecked_write_paths);
    return .{
        .action_id = action_id,
        .next_action_id = next_action,
        .compute_root = compute_root,
        .merge_warnings = merge_warnings,
        .unchecked_write_paths = unchecked_write_paths,
        .next_warnings = try allocator.dupe(model_runtime.NextRuleWarning, selection.warnings),
    };
}

fn findScene(model: *const model_runtime.RuntimeModel, scene_id: []const u8) ?std.json.ObjectMap {
    const scenes = model.root().get("scenes") orelse return null;
    if (scenes != .array) return null;
    for (scenes.array.items) |scene| {
        if (scene != .object) continue;
        const id = scene.object.get("id") orelse continue;
        if (id == .string and std.mem.eql(u8, id.string, scene_id)) return scene.object;
    }
    return null;
}

fn validateScene(scene: std.json.ObjectMap, allocator: std.mem.Allocator) ![]const u8 {
    const entry = scene.get("entryAction") orelse return error.NoEntryAction;
    const actions = scene.get("actions") orelse return error.NoEntryAction;
    if (entry != .string or entry.string.len == 0 or actions != .array) return error.NoEntryAction;
    var ids: std.StringHashMapUnmanaged(void) = .empty;
    defer ids.deinit(allocator);
    var found_entry = false;
    for (actions.array.items) |action| {
        if (action != .object) return error.InvalidAction;
        const id = action.object.get("id") orelse return error.InvalidAction;
        if (id != .string or id.string.len == 0) return error.InvalidAction;
        const slot = try ids.getOrPut(allocator, id.string);
        if (slot.found_existing) return error.DuplicateActionId;
        if (std.mem.eql(u8, id.string, entry.string)) found_entry = true;
    }
    if (!found_entry) return error.ActionNotFound;
    return entry.string;
}

test "scene executes first-match action chain" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"first","actions":[
        \\  {
        \\    "id":"first",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","value":1}
        \\    ]}},
        \\    "merge":[{"binding":"out","toState":"step.first"}],
        \\    "next":[{"action":"second"}]
        \\  },
        \\  {
        \\    "id":"second",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","value":2}
        \\    ]}},
        \\    "merge":[{"binding":"out","toState":"step.second"}]
        \\  }
        \\]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try execute(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.traces.len);
    try std.testing.expectEqualStrings("first", result.traces[0].action_id);
    try std.testing.expectEqualStrings("second", result.traces[1].action_id);
    try std.testing.expectEqual(@as(usize, 1), result.terminated_at.len);
    try std.testing.expectEqualStrings("second", result.terminated_at[0]);
    try std.testing.expectEqual(@as(usize, 6), result.logs.len);
    try std.testing.expectEqual(LogKind.action_start, result.logs[0].kind);
    try std.testing.expectEqual(LogKind.warning, result.logs[1].kind);
    try std.testing.expectEqual(LogWarningKind.unchecked_state_write, result.logs[1].warning_kind.?);
    try std.testing.expectEqual(LogKind.action_complete, result.logs[2].kind);
}

test "scene suppresses duplicate enqueue and enforces step limit" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"a","actions":[
        \\  {"id":"a","next":[{"action":"b"}]},
        \\  {"id":"b","next":[{"action":"a"}]}
        \\]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var result = try execute(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 2), result.traces.len);
    try std.testing.expectEqual(@as(usize, 1), result.duplicate_warnings.len);
    try std.testing.expectEqualStrings("a", result.duplicate_warnings[0].action_id);
    try std.testing.expect(result.duplicate_warnings[0].first_enqueued_by == null);
    try std.testing.expectEqual(@as(usize, 5), result.logs.len);
    try std.testing.expectEqual(LogKind.warning, result.logs[3].kind);
    try std.testing.expectEqual(LogWarningKind.duplicate_enqueue, result.logs[3].warning_kind.?);
    try std.testing.expectEqual(LogKind.action_complete, result.logs[4].kind);
    try std.testing.expectError(error.MaxStepsExceeded, execute(&model, "main", &state, 1, std.testing.allocator));
}

test "safe scene result preserves committed state and failed action" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","entryAction":"first","actions":[
        \\  {
        \\    "id":"first",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","value":1}
        \\    ]}},
        \\    "merge":[{"binding":"out","toState":"step.first"}],
        \\    "next":[{"action":"second"}]
        \\  },
        \\  {
        \\    "id":"second",
        \\    "compute":{"root":"out","prog":{"bindings":[
        \\      {"name":"out","type":"number","expr":{
        \\        "combine":{"fn":"not_a_function","args":[{"lit":1},{"lit":2}]}
        \\      }}
        \\    ]}}
        \\  }
        \\]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    const empty: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    var state = try state_runtime.State.initUnchecked(&empty, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var safe = try executeSafe(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer safe.deinit(std.testing.allocator);
    switch (safe) {
        .success => return error.TestExpectedFailure,
        .failure => |*failure| {
            try std.testing.expectEqual(error.UnknownFunction, failure.err);
            try std.testing.expectEqual(runtime_error.Code.unknown_function, failure.code);
            try std.testing.expectEqualStrings("second", failure.failed_action_id.?);
            try std.testing.expectEqual(@as(usize, 4), failure.logs.len);
            try std.testing.expectEqual(LogKind.action_start, failure.logs[3].kind);
            try std.testing.expectEqualStrings("second", failure.logs[3].action_id);
            var committed = try failure.partial_state.read("step.first", std.testing.allocator);
            defer committed.deinit(std.testing.allocator);
            try std.testing.expectEqual(@as(f64, 1), committed.value.number);
        },
    }
}

test "safe scene construction failure retains initial state without action id" {
    const fixture =
        \\{"version":2,"scenes":[{"id":"main","actions":[]}]}
    ;
    var model = try model_runtime.RuntimeModel.init(std.testing.allocator, fixture, .{});
    defer model.deinit();
    var initial: std.StringArrayHashMapUnmanaged(turnout_value.TaggedValue) = .empty;
    defer initial.deinit(std.testing.allocator);
    try initial.put(std.testing.allocator, "kept", .{ .value = .{ .boolean = true } });
    var state = try state_runtime.State.initUnchecked(&initial, std.testing.allocator);
    defer state.deinit(std.testing.allocator);
    var safe = try executeSafe(&model, "main", &state, default_max_steps, std.testing.allocator);
    defer safe.deinit(std.testing.allocator);
    switch (safe) {
        .success => return error.TestExpectedFailure,
        .failure => |*failure| {
            try std.testing.expectEqual(error.NoEntryAction, failure.err);
            try std.testing.expectEqual(runtime_error.Code.no_entry_action, failure.code);
            try std.testing.expect(failure.failed_action_id == null);
            try std.testing.expectEqual(@as(usize, 0), failure.logs.len);
            try std.testing.expect(try failure.partial_state.exists("kept"));
        },
    }
}
